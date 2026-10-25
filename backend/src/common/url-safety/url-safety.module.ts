import { Module } from '@nestjs/common';
import { promises as dns } from 'dns';
import { DNS_LOOKUP, DnsLookup, UrlSafetyService } from './url-safety.service';

const systemLookup: DnsLookup = async (hostname) => {
  // all: true → every A and AAAA record, not just the first one.
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

@Module({
  providers: [UrlSafetyService, { provide: DNS_LOOKUP, useValue: systemLookup }],
  exports: [UrlSafetyService],
})
export class UrlSafetyModule {}
