globalThis.SiteRules = (() => {
  const decoder = new TextDecoder();
  const compiled = new WeakMap();

  function fields(bytes) {
    let position = 0;
    function integer() {
      let value = 0, factor = 1;
      while (position < bytes.length) {
        const byte = bytes[position++];
        value += (byte & 127) * factor;
        if (byte < 128) return value;
        factor *= 128;
      }
      throw new Error('Truncated rule database');
    }
    const result = [];
    while (position < bytes.length) {
      const tag = integer(), wire = tag & 7;
      let value;
      if (wire === 0) value = integer();
      else if (wire === 2) {
        const length = integer();
        if (position + length > bytes.length) throw new Error('Truncated rule database');
        value = bytes.subarray(position, position + length);
        position += length;
      } else if (wire === 1 || wire === 5) position += wire === 1 ? 8 : 4;
      else throw new Error('Unsupported rule database format');
      result.push({ number: Math.floor(tag / 8), wire, value });
    }
    return result;
  }

  function database(bytes) {
    return fields(bytes).filter(field => field.number === 1 && field.wire === 2).map(entry => {
      const data = fields(entry.value);
      const name = data.find(field => field.number === 1 && field.wire === 2);
      const rules = data.filter(field => field.number === 2 && field.wire === 2).map(field => {
        const rule = fields(field.value);
        const address = rule.find(item => item.number === 1 && item.wire === 2);
        if (address) {
          const prefix = rule.find(item => item.number === 2 && item.wire === 0)?.value || 0;
          const ip = address.value;
          if (ip.length !== 4 && ip.length !== 16) throw new Error('Invalid GeoIP address');
          const value = ip.length === 4 ? [...ip].join('.')
            : Array.from({ length: 8 }, (_, i) => ((ip[i * 2] << 8) | ip[i * 2 + 1]).toString(16)).join(':');
          return { kind: 'ip', value: `${value}/${prefix}` };
        }
        const type = rule.find(item => item.number === 1 && item.wire === 0)?.value || 0;
        const value = rule.find(item => item.number === 2 && item.wire === 2);
        const kind = ['keyword', 'regexp', 'domain', 'full'][type];
        if (!kind || !value) throw new Error('Invalid GeoSite rule');
        const attributes = rule.filter(item => item.number === 3 && item.wire === 2).map(item => {
          const key = fields(item.value).find(attribute => attribute.number === 1 && attribute.wire === 2);
          return key ? decoder.decode(key.value) : '';
        }).filter(Boolean);
        return { kind, value: decoder.decode(value.value), attributes };
      });
      return { name: name ? decoder.decode(name.value).toLowerCase() : '',
        inverse: Boolean(data.find(field => field.number === 3 && field.wire === 0)?.value), rules };
    });
  }

  function filtersMatch(rule, filters) {
    return filters.every(filter => filter.startsWith('!')
      ? !(rule.attributes || []).includes(filter.slice(1)) : (rule.attributes || []).includes(filter));
  }

  function lineRules(input) {
    let line = input.replace(/#.*$/, '').trim();
    if (!line || line === 'payload:') return [];
    line = line.replace(/^-\s+/, '').replace(/^['"]|['"]$/g, '');
    const attributes = [...line.matchAll(/\s+@([^\s]+)/g)].map(match => match[1]);
    line = line.replace(/\s+@[^\s]+/g, '').trim();
    const clash = line.match(/^(DOMAIN-SUFFIX|DOMAIN|DOMAIN-KEYWORD|IP-CIDR6?),([^,]+)(?:,.*)?$/i);
    if (clash) {
      const kind = { 'DOMAIN-SUFFIX': 'domain', DOMAIN: 'full', 'DOMAIN-KEYWORD': 'keyword' }[clash[1].toUpperCase()] || 'ip';
      return [{ kind, value: clash[2].trim(), attributes }];
    }
    const typed = line.match(/^(domain|full|keyword|regexp|include|ip):(.+)$/i);
    if (typed) return [{ kind: typed[1].toLowerCase(), value: typed[2].trim(), attributes }];
    return line.split(',').filter(Boolean).map(value => ({
      kind: /^[\d.]+(?:\/\d+)?$/.test(value.trim()) || value.includes(':') && !value.includes('://') ? 'ip' : 'domain',
      value: value.trim(), attributes
    }));
  }

  async function textRules(text, name, load, stack = []) {
    if (stack.includes(name)) throw new Error(`Circular include: ${name}`);
    const rules = [];
    for (const line of text.split(/\r?\n/)) {
      for (const rule of lineRules(line)) {
        if (rule.kind !== 'include') rules.push(rule);
        else {
          if (!load) throw new Error(`Include requires its source file: ${rule.value}`);
          const included = await load(rule.value, name);
          const nested = await textRules(decoder.decode(included.bytes), included.name, load, [...stack, name]);
          rules.push(...nested.filter(item => filtersMatch(item, rule.attributes)));
        }
      }
    }
    return rules;
  }

  async function parse(input, options = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const name = options.name || '';
    const binary = /\.dat(?:$|[?#])/i.test(name) || bytes.subarray(0, 512).some(byte => byte < 9 || byte > 13 && byte < 32);
    let groups = binary ? database(bytes) : [{
      name: name.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase(), inverse: false,
      rules: await textRules(decoder.decode(bytes), name, options.load)
    }];
    const selectors = String(options.categories || '').split(/[\s,]+/).filter(Boolean);
    if (selectors.length) {
      groups = selectors.map(selector => {
        const [category, ...attributes] = selector.toLowerCase().replace(/^(geosite|geoip):/, '').split('@');
        const group = groups.find(item => item.name === category);
        if (!group) throw new Error(`Category not found: ${category}`);
        return { ...group, rules: group.rules.filter(rule => filtersMatch(rule, attributes)) };
      });
    }
    if (!groups.some(group => group.rules.length)) throw new Error('No matching rules found');
    compile({ domains: [], sources: [{ groups }] });
    return groups;
  }

  function ipValue(input) {
    let value = input.replace(/^\[|\]$/g, '');
    if (!value.includes(':')) {
      const parts = value.split('.');
      if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) throw new Error(`Invalid IP: ${input}`);
      return { bits: 32, value: parts.reduce((result, part) => result * 256n + BigInt(part), 0n) };
    }
    if (value.includes('.')) {
      const index = value.lastIndexOf(':');
      const ipv4 = ipValue(value.slice(index + 1)).value;
      value = `${value.slice(0, index)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 65535n).toString(16)}`;
    }
    const halves = value.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    if (halves.length > 2 || parts.length !== 8 || parts.some(part => !/^[a-f\d]{1,4}$/i.test(part))) throw new Error(`Invalid IP: ${input}`);
    return { bits: 128, value: parts.reduce((result, part) => result * 65536n + BigInt(`0x${part}`), 0n) };
  }

  function ranges(rules) {
    const result = { 32: [], 128: [] };
    for (const rule of rules) {
      const [address, mask] = rule.value.split('/');
      const ip = ipValue(address);
      const prefix = mask === undefined ? ip.bits : Number(mask);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.bits) throw new Error(`Invalid CIDR: ${rule.value}`);
      const size = 1n << BigInt(ip.bits - prefix);
      const start = ip.value / size * size;
      result[ip.bits].push([start, start + size - 1n]);
    }
    for (const bits of [32, 128]) {
      const merged = [];
      for (const range of result[bits].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1] + 1n) last[1] = last[1] > range[1] ? last[1] : range[1];
        else merged.push(range);
      }
      result[bits] = merged;
    }
    return result;
  }

  function contains(rangesByBits, ip) {
    const values = rangesByBits[ip.bits];
    let low = 0, high = values.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (ip.value < values[middle][0]) high = middle - 1;
      else if (ip.value > values[middle][1]) low = middle + 1;
      else return true;
    }
    return false;
  }

  function regexp(value) {
    let flags = '';
    value = value.replace(/^\(\?([ims]+)\)/, (_, options) => { flags = options; return ''; });
    value = value.replace(/\\A/g, '^').replace(/\\z/g, '$').replace(/\\Q(.*?)\\E/g, (_, literal) => literal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'));
    return new RegExp(value, flags);
  }

  function compile(config) {
    if (compiled.has(config)) return compiled.get(config);
    const manual = (config.domains || []).flatMap(lineRules);
    const groups = (config.sources || []).flatMap(source => source.groups || []);
    const rules = [...manual, ...groups.filter(group => !group.inverse).flatMap(group => group.rules)];
    const suffixes = new Set(), exact = new Set(), keywords = [], expressions = [];
    for (const rule of rules) {
      if (rule.kind === 'domain' || rule.kind === 'full') {
        const input = rule.value.replace(/^(?:\*|\+)\./, '').replace(/^\./, '');
        const hostname = new URL(input.includes('://') ? input : `http://${input}`).hostname.toLowerCase().replace(/\.$/, '');
        (rule.kind === 'full' ? exact : suffixes).add(hostname);
      } else if (rule.kind === 'keyword') keywords.push(rule.value.toLowerCase());
      else if (rule.kind === 'regexp') expressions.push(regexp(rule.value));
      else if (rule.kind !== 'ip') throw new Error(`Unsupported rule: ${rule.kind}:${rule.value}`);
    }
    const ips = ranges(rules.filter(rule => rule.kind === 'ip'));
    const inverse = groups.filter(group => group.inverse).map(group => ranges(group.rules));
    const match = hostname => {
      const host = hostname.toLowerCase().replace(/\.$/, '');
      if (exact.has(host)) return true;
      let suffix = host;
      while (suffix) {
        if (suffixes.has(suffix)) return true;
        const dot = suffix.indexOf('.');
        if (dot < 0) break;
        suffix = suffix.slice(dot + 1);
      }
      if (keywords.some(keyword => host.includes(keyword)) || expressions.some(expression => expression.test(host))) return true;
      if (/^[\d.]+$/.test(host) || host.includes(':')) {
        const ip = ipValue(host);
        return contains(ips, ip) || inverse.some(group => !contains(group, ip));
      }
      return false;
    };
    compiled.set(config, match);
    return match;
  }

  return { parse, compile };
})();
