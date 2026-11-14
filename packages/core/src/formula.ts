export type FormulaError = '#VALUE!' | '#REF!' | '#DIV/0!' | '#CYCLE!' | '#LIMIT!';
export type FormulaResult = number | FormulaError;

/** Evaluate arithmetic over numeric literals and A1 references. The reader supplies stored cell contents. */
export function evaluateFormula(
  formula: string,
  readCell: (address: string) => number | string | undefined,
): FormulaResult {
  const active = new Set<string>();
  const memo = new Map<string, number>();
  let remaining = 4096;
  function parse(input: string, depth: number): number {
    if (depth > 64 || input.length > 4096 || (remaining -= input.length) < 0) throw '#LIMIT!';
    if (!input.startsWith('=')) throw '#VALUE!';
    const token = /\s*([A-Z]+[1-9]\d*|(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-])/iy;
    let position = 1;
    function peek(): string | undefined {
      token.lastIndex = position;
      return token.exec(input)?.[1];
    }
    function take(): string | undefined {
      const value = peek();
      if (value) position = token.lastIndex;
      return value;
    }
    function expression(precedence: number, nesting: number): number {
      if (nesting + depth > 64) throw '#LIMIT!';
      const first = take();
      if (!first) throw '#VALUE!';
      let value: number;
      if (first === '(') {
        value = expression(0, nesting + 1);
        if (take() !== ')') throw '#VALUE!';
      } else if (first === '+' || first === '-') {
        value = expression(3, nesting + 1) * (first === '-' ? -1 : 1);
      } else if (/^[a-z]/i.test(first)) {
        const address = first.toUpperCase();
        if (active.has(address)) throw '#CYCLE!';
        const cached = memo.get(address);
        if (cached !== undefined) value = cached;
        else {
          const cell = readCell(address);
          if (cell === undefined) throw '#REF!';
          active.add(address);
          value = typeof cell === 'number' ? cell : parse(cell, depth + 1);
          active.delete(address);
          memo.set(address, value);
        }
      } else value = Number(first);
      while (true) {
        const operator = peek();
        const rank = operator === '*' || operator === '/' ? 2 : operator === '+' || operator === '-' ? 1 : -1;
        if (rank < precedence) break;
        take();
        const right = expression(rank + 1, nesting + 1);
        if (operator === '/' && right === 0) throw '#DIV/0!';
        if (operator === '+') value += right;
        else if (operator === '-') value -= right;
        else if (operator === '*') value *= right;
        else value /= right;
      }
      if (!Number.isFinite(value)) throw '#VALUE!';
      return value;
    }
    const result = expression(0, 0);
    if (input.slice(position).trim()) throw '#VALUE!';
    return result;
  }
  try {
    return parse(formula, 0);
  } catch (error) {
    if (error === '#REF!' || error === '#DIV/0!' || error === '#CYCLE!' || error === '#LIMIT!') return error;
    return '#VALUE!';
  }
}
