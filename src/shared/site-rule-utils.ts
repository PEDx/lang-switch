export function createExactPathnamePattern(pathname: string): string {
  return `^${pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
}
