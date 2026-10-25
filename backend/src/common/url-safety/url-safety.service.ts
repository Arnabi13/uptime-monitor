import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';

/** Resolves a hostname to every IP address it points at. Injectable so tests can fake DNS. */
export type DnsLookup = (hostname: string) => Promise<string[]>;
export const DNS_LOOKUP = Symbol('DNS_LOOKUP');

export interface SafeUrl {
  /** Normalised URL string that gets stored. */
  url: string;
  /** Lowercased hostname (no brackets for IPv6). */
  host: string;
  /** Every address the host resolved to — all of them are public. */
  addresses: string[];
}

const MAX_URL_LENGTH = 2048;

// Names that only mean something inside a private network.
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

/**
 * SSRF guard.
 *
 * Our server makes HTTP requests to URLs that users type in. Without this,
 * a user could point a monitor at:
 *   - http://169.254.169.254/...  → the EC2 metadata service (IAM credentials!)
 *   - http://localhost:5432 or http://db:5432 → our own Postgres
 *   - http://10.0.1.23 → anything else inside the VPC
 * and use our server as a proxy into our private network.
 *
 * Rule: a URL is allowed only if EVERY IP its hostname resolves to is a public
 * unicast address. One private record is enough to reject it, because an
 * attacker can publish both a public and a private A record for one name.
 *
 * Important: validating at creation time is not enough on its own — DNS can
 * change after we check it (a "DNS rebinding" attack). The Day 2 worker calls
 * assertSafe() again right before every check and connects to the IP it
 * validated, so the check and the request can't see different answers.
 */
@Injectable()
export class UrlSafetyService {
  constructor(@Inject(DNS_LOOKUP) private readonly lookup: DnsLookup) {}

  /** Synchronous checks that don't need DNS: syntax, scheme, credentials, hostname shape. */
  normalize(raw: string): { url: string; host: string } {
    const input = raw?.trim() ?? '';
    if (!input || input.length > MAX_URL_LENGTH) {
      throw new BadRequestException(`URL must be between 1 and ${MAX_URL_LENGTH} characters`);
    }

    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new BadRequestException('URL is not valid');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only http and https URLs can be monitored');
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('URLs with embedded credentials are not allowed');
    }

    // The WHATWG URL parser already turns tricks like http://2130706433 or
    // http://0x7f.1 into a canonical IP ("127.0.0.1"), so we check its output.
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) {
      throw new BadRequestException('URL must include a hostname');
    }

    if (!ipaddr.isValid(host)) {
      if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
        throw new BadRequestException('Internal hostnames cannot be monitored');
      }
      // Single-label names ("db", "redis", "postgres") resolve to other containers
      // inside Docker Compose or to intranet machines. Real public sites have a dot.
      if (!host.includes('.')) {
        throw new BadRequestException('Hostname must be a fully qualified domain name');
      }
    }

    parsed.hash = ''; // fragments are never sent to the server; drop them so duplicates match
    return { url: parsed.toString(), host };
  }

  /** Full check: normalize + resolve DNS + verify every resolved address is public. */
  async assertSafe(raw: string): Promise<SafeUrl> {
    const { url, host } = this.normalize(raw);

    let addresses: string[];
    if (ipaddr.isValid(host)) {
      addresses = [host];
    } else {
      try {
        addresses = await this.lookup(host);
      } catch {
        throw new BadRequestException(`Could not resolve hostname "${host}"`);
      }
      if (addresses.length === 0) {
        throw new BadRequestException(`Could not resolve hostname "${host}"`);
      }
    }

    if (!addresses.every((a) => UrlSafetyService.isPublicAddress(a))) {
      // Deliberately vague: don't tell an attacker which internal address matched.
      throw new BadRequestException('URL points to a private or reserved network address');
    }

    return { url, host, addresses };
  }

  /**
   * True only for globally routable unicast addresses.
   * Rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local
   * (169.254/16 — includes EC2 metadata), carrier-grade NAT, multicast,
   * reserved, IPv6 unique-local, and IPv6 tunnelling ranges that can embed
   * an IPv4 address (6to4, Teredo).
   */
  static isPublicAddress(address: string): boolean {
    if (!ipaddr.isValid(address)) return false;
    let ip = ipaddr.parse(address);

    // ::ffff:127.0.0.1 is just 127.0.0.1 wearing an IPv6 costume.
    if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    }
    return ip.range() === 'unicast';
  }
}
