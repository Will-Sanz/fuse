/** Quote a suggested POSIX-shell argument; JSON quoting does not prevent shell expansion. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
