/** Easter egg helpers: a joke "hacking" screen made of meaningless text. Nothing here is real. */

export const SECRET_CODE = "bald";

export function isSecretCode(input: string): boolean {
  return input.trim().toLowerCase() === SECRET_CODE;
}

const HEX = "0123456789abcdef";
const WORDS = [
  "uplink", "mainframe", "firewall", "handshake", "proxy", "satellite", "payload", "kernel", "cipher",
  "bypass", "tunnel", "socket", "daemon", "matrix", "protocol", "packet", "router", "vector", "buffer", "token",
];
const VERBS = ["decrypting", "injecting", "rerouting", "spoofing", "compiling", "negotiating", "flooding", "mapping", "unlocking"];
const OPS = ["mov", "xor", "push", "pop", "jmp", "call", "lea", "shl", "and", "cmp"];
const REGS = ["eax", "ebx", "ecx", "edx", "esi", "edi", "rsp", "rbp"];

/** rand must return a number in [0, 1). Injected so the output is testable. */
export function nonsenseLine(rand: () => number): string {
  const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];
  const hex = (n: number) => Array.from({ length: n }, () => pick([...HEX])).join("");
  switch (Math.floor(rand() * 6)) {
    case 0:
      return `0x${hex(8)}  ${pick(OPS)} ${pick(REGS)}, 0x${hex(4)}`;
    case 1:
      return `${pick(VERBS)} ${pick(WORDS)}_${pick(WORDS)} ... ${Math.floor(rand() * 100)}%`;
    case 2:
      return `for (int i = 0; i < 0x${hex(2)}; i++) { ${pick(WORDS)}[i] ^= 0x${hex(2)}; }`;
    case 3:
      return `${hex(32)}`;
    case 4:
      return `[${hex(4).toUpperCase()}] ${pick(WORDS)}.${pick(WORDS)}() -> ${rand() < 0.5 ? "OK" : "RETRY"}`;
    default:
      return `sudo ${pick(WORDS)} --${pick(WORDS)}=${hex(6)} --force --please`;
  }
}
