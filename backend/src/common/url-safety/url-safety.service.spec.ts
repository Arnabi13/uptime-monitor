import { BadRequestException } from '@nestjs/common';
import { DnsLookup, UrlSafetyService } from './url-safety.service';

/** Fake DNS so tests are fast, deterministic and work offline. */
const fakeDns: Record<string, string[]> = {
  'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'internal.evil.test': ['10.0.0.5'],
  'mixed.evil.test': ['93.184.215.14', '127.0.0.1'], // one public + one private record
  'metadata.evil.test': ['169.254.169.254'],
  'mapped.evil.test': ['::ffff:127.0.0.1'],
  'empty.test': [],
};
const lookup: DnsLookup = async (host) => {
  if (!(host in fakeDns)) throw new Error('ENOTFOUND');
  return fakeDns[host];
};

describe('UrlSafetyService', () => {
  const service = new UrlSafetyService(lookup);

  const expectRejected = async (url: string) => {
    await expect(service.assertSafe(url)).rejects.toBeInstanceOf(BadRequestException);
  };

  describe('accepts public URLs', () => {
    it('resolves and returns every address', async () => {
      const result = await service.assertSafe('https://Example.com/health#section');
      expect(result.host).toBe('example.com');
      expect(result.url).toBe('https://example.com/health'); // lowercased host, fragment dropped
      expect(result.addresses).toHaveLength(2);
    });

    it('accepts a public IP literal without DNS', async () => {
      const result = await service.assertSafe('http://8.8.8.8');
      expect(result.addresses).toEqual(['8.8.8.8']);
    });
  });

  describe('rejects bad syntax and schemes', () => {
    it.each(['', 'not a url', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)'])(
      '%s',
      (url) => expectRejected(url),
    );

    it('rejects embedded credentials', () => expectRejected('https://user:pass@example.com'));
    it('rejects overly long URLs', () => expectRejected(`https://example.com/${'a'.repeat(2100)}`));
  });

  describe('rejects internal hostnames', () => {
    it.each([
      'http://localhost:3000',
      'http://api.localhost',
      'http://printer.local',
      'http://service.internal',
      'http://db:5432', // single-label: another Docker Compose container
      'http://postgres',
    ])('%s', (url) => expectRejected(url));
  });

  describe('rejects private and reserved IP literals', () => {
    it.each([
      'http://127.0.0.1',
      'http://10.0.0.1',
      'http://172.16.5.4',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data/', // EC2 metadata
      'http://100.64.0.1', // carrier-grade NAT
      'http://0.0.0.0',
      'http://[::1]',
      'http://[fd00::1]', // IPv6 unique-local
      'http://[::ffff:127.0.0.1]', // IPv4-mapped IPv6
      'http://2130706433', // decimal form of 127.0.0.1
      'http://0x7f.1', // hex shorthand of 127.0.0.1
    ])('%s', (url) => expectRejected(url));
  });

  describe('rejects hostnames that resolve to private addresses', () => {
    it.each([
      'https://internal.evil.test',
      'https://mixed.evil.test', // one private record is enough to reject
      'https://metadata.evil.test',
      'https://mapped.evil.test',
    ])('%s', (url) => expectRejected(url));
  });

  it('rejects hostnames that do not resolve', async () => {
    await expectRejected('https://does-not-exist.test');
    await expectRejected('https://empty.test');
  });

  describe('isPublicAddress', () => {
    it.each([
      ['8.8.8.8', true],
      ['2606:4700:4700::1111', true],
      ['10.1.2.3', false],
      ['169.254.169.254', false],
      ['::ffff:10.0.0.1', false],
      ['2002:7f00:0001::', false], // 6to4 wrapping 127.0.0.1
      ['garbage', false],
    ])('%s → %s', (ip, expected) => {
      expect(UrlSafetyService.isPublicAddress(ip as string)).toBe(expected);
    });
  });
});
