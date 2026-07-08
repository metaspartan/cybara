const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  trunc: Math.trunc,
  pow: (a, b) => a ** b,
  atan2: (a, b) => Math.atan2(a, b),
  min: (...values) => Math.min(...values),
  max: (...values) => Math.max(...values),
};

type Token =
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" };

function tokenizeExpression(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i + 1;
      while (j < input.length && /[0-9.eE+\-]/.test(input[j])) {
        const c = input[j];
        if ((c === "+" || c === "-") && !(input[j - 1] === "e" || input[j - 1] === "E")) break;
        j += 1;
      }
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Invalid number: ${raw}`);
      tokens.push({ kind: "number", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j += 1;
      tokens.push({ kind: "ident", value: input.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i += 1;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      if (ch === "*" && input[i + 1] === "*") {
        tokens.push({ kind: "op", value: "^" });
        i += 2;
        continue;
      }
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

function evaluateExpression(input: string): number {
  const tokens = tokenizeExpression(input);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const parsePrimary = (): number => {
    const token = next();
    if (!token) throw new Error("Unexpected end of expression");
    if (token.kind === "number") return token.value;
    if (token.kind === "op" && (token.value === "+" || token.value === "-")) {
      const operand = parseUnary();
      return token.value === "-" ? -operand : operand;
    }
    if (token.kind === "paren" && token.value === "(") {
      const value = parseAdditive();
      const close = next();
      if (!close || close.kind !== "paren" || close.value !== ")") {
        throw new Error("Expected closing parenthesis");
      }
      return value;
    }
    if (token.kind === "ident") {
      if (token.value in MATH_CONSTANTS && peek()?.kind !== "paren") {
        return MATH_CONSTANTS[token.value];
      }
      const fn = MATH_FUNCTIONS[token.value];
      if (!fn) throw new Error(`Unknown identifier: ${token.value}`);
      const open = next();
      if (!open || open.kind !== "paren" || open.value !== "(") {
        throw new Error(`Expected '(' after ${token.value}`);
      }
      const callArgs: number[] = [];
      if (peek()?.kind !== "paren" || (peek() as { value?: string }).value !== ")") {
        callArgs.push(parseAdditive());
        while (peek()?.kind === "comma") {
          next();
          callArgs.push(parseAdditive());
        }
      }
      const close = next();
      if (!close || close.kind !== "paren" || close.value !== ")") {
        throw new Error(`Expected ')' after ${token.value} arguments`);
      }
      return fn(...callArgs);
    }
    throw new Error("Unexpected token in expression");
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek()?.kind === "op" && (peek() as { value: string }).value === "^") {
      next();
      return base ** parseUnary();
    }
    return base;
  };

  function parseUnary(): number {
    const token = peek();
    if (token?.kind === "op" && (token.value === "+" || token.value === "-")) {
      next();
      const operand = parseUnary();
      return token.value === "-" ? -operand : operand;
    }
    return parsePower();
  }

  const parseMultiplicative = (): number => {
    let value = parseUnary();
    for (;;) {
      const token = peek();
      if (
        token?.kind === "op" &&
        (token.value === "*" || token.value === "/" || token.value === "%")
      ) {
        next();
        const rhs = parseUnary();
        if (token.value === "*") value *= rhs;
        else if (token.value === "/") value /= rhs;
        else value %= rhs;
      } else {
        break;
      }
    }
    return value;
  };

  function parseAdditive(): number {
    let value = parseMultiplicative();
    for (;;) {
      const token = peek();
      if (token?.kind === "op" && (token.value === "+" || token.value === "-")) {
        next();
        const rhs = parseMultiplicative();
        value = token.value === "+" ? value + rhs : value - rhs;
      } else {
        break;
      }
    }
    return value;
  }

  const result = parseAdditive();
  if (pos !== tokens.length) throw new Error("Unexpected trailing tokens");
  return result;
}

export async function handleCalc(args: Record<string, unknown>): Promise<unknown> {
  const expression = args.expression as string;

  if (!expression || typeof expression !== "string") {
    throw new Error("Expression is required");
  }
  if (expression.length > 1000) {
    throw new Error("Expression is too long");
  }

  try {
    const result = evaluateExpression(expression);
    if (typeof result !== "number" || !Number.isFinite(result)) {
      throw new Error("Invalid result - expression must produce a finite number");
    }
    return { result, expression };
  } catch (e) {
    throw new Error(`Failed to evaluate expression: ${(e as Error).message}`);
  }
}

// Convert tool - convert between units
export async function handleConvert(args: Record<string, unknown>): Promise<unknown> {
  const value = args.value as number;
  const from = args.from as string;
  const to = args.to as string;

  if (value === undefined || value === null) {
    throw new Error("Value is required");
  }
  if (!from) {
    throw new Error("Source unit (from) is required");
  }
  if (!to) {
    throw new Error("Target unit (to) is required");
  }

  // Normalize units to lowercase
  const fromUnit = from.toLowerCase();
  const toUnit = to.toLowerCase();

  // Conversion factors to base units (meters, kilograms, Kelvin)
  const lengthToMeters: Record<string, number> = {
    m: 1,
    meter: 1,
    meters: 1,
    km: 1000,
    kilometer: 1000,
    kilometers: 1000,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    mi: 1609.344,
    mile: 1609.344,
    miles: 1609.344,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
    // A nautical mile is exactly 1852 meters (the previous 1.852e+9 was wrong by
    // ~1e6). Use `nmi` for nautical miles; `nm` is the SI nanometer (1e-9 m).
    nmi: 1852,
    "nautical mile": 1852,
    "nautical miles": 1852,
    nm: 1e-9, // nanometer
    nanometer: 1e-9,
    nanometers: 1e-9,
  };

  const weightToKg: Record<string, number> = {
    kg: 1,
    kilogram: 1,
    kilograms: 1,
    g: 0.001,
    gram: 0.001,
    grams: 0.001,
    mg: 1e-6,
    milligram: 1e-6,
    milligrams: 1e-6,
    lb: 0.453592,
    lbs: 0.453592,
    pound: 0.453592,
    pounds: 0.453592,
    oz: 0.0283495,
    ounce: 0.0283495,
    ounces: 0.0283495,
    ton: 907.185,
    tonnes: 907.185,
    "metric ton": 1000,
    "metric tons": 1000,
  };

  // Temperature conversion (to Kelvin, then to target)
  const toKelvin = (val: number, unit: string): number => {
    switch (unit) {
      case "c":
      case "celsius":
        return val + 273.15;
      case "f":
      case "fahrenheit":
        return (val - 32) * (5 / 9) + 273.15;
      case "k":
      case "kelvin":
        return val;
      default:
        throw new Error(`Unknown temperature unit: ${unit}`);
    }
  };

  const fromKelvin = (val: number, unit: string): number => {
    switch (unit) {
      case "c":
      case "celsius":
        return val - 273.15;
      case "f":
      case "fahrenheit":
        return (val - 273.15) * (9 / 5) + 32;
      case "k":
      case "kelvin":
        return val;
      default:
        throw new Error(`Unknown temperature unit: ${unit}`);
    }
  };

  // Determine type and convert
  let result: number;

  // Check if it's a temperature conversion
  const tempUnits = ["c", "celsius", "f", "fahrenheit", "k", "kelvin"];
  if (tempUnits.includes(fromUnit) && tempUnits.includes(toUnit)) {
    const kelvin = toKelvin(value, fromUnit);
    result = fromKelvin(kelvin, toUnit);
  }
  // Check length conversions
  else if (fromUnit in lengthToMeters && toUnit in lengthToMeters) {
    const meters = value * lengthToMeters[fromUnit];
    result = meters / lengthToMeters[toUnit];
  }
  // Check weight conversions
  else if (fromUnit in weightToKg && toUnit in weightToKg) {
    const kg = value * weightToKg[fromUnit];
    result = kg / weightToKg[toUnit];
  } else {
    throw new Error(
      `Cannot convert from '${from}' to '${to}'. Supported categories: length (m, km, ft, lb, etc.), weight (kg, g, lb, oz, etc.), temperature (c, f, k)`
    );
  }

  return {
    result,
    from: args.from,
    to: args.to,
    value: args.value,
  };
}
