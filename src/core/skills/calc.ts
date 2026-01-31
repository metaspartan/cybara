// Calculator skill - safe math evaluation using mathjs-like parsing

// Simple expression evaluator (safe, no eval)
function evaluateExpression(expr: string): number {
    // Remove whitespace
    expr = expr.replace(/\s+/g, "");

    // Basic validation - only allow math characters
    if (!/^[\d+\-*/().^%sqrt,e]+$/i.test(expr)) {
        throw new Error("Invalid characters in expression");
    }

    // Handle sqrt
    expr = expr.replace(/sqrt\(([^)]+)\)/gi, (_, inner) => {
        return String(Math.sqrt(evaluateExpression(inner)));
    });

    // Handle exponentiation (^)
    expr = expr.replace(/(\d+\.?\d*)\^(\d+\.?\d*)/g, (_, base, exp) => {
        return String(Math.pow(parseFloat(base), parseFloat(exp)));
    });

    // Handle parentheses recursively
    while (expr.includes("(")) {
        expr = expr.replace(/\(([^()]+)\)/g, (_, inner) => {
            return String(evaluateExpression(inner));
        });
    }

    // Parse remaining expression with standard operators
    // First handle * and /
    const tokens = expr.match(/(\d+\.?\d*|[+\-*/])/g);
    if (!tokens) return 0;

    // Convert to postfix and evaluate
    const values: number[] = [];
    const ops: string[] = [];

    const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

    const applyOp = () => {
        const op = ops.pop()!;
        const b = values.pop()!;
        const a = values.pop()!;
        switch (op) {
            case "+":
                values.push(a + b);
                break;
            case "-":
                values.push(a - b);
                break;
            case "*":
                values.push(a * b);
                break;
            case "/":
                values.push(a / b);
                break;
        }
    };

    for (const token of tokens) {
        if (/\d/.test(token)) {
            values.push(parseFloat(token));
        } else {
            while (ops.length > 0 && precedence[ops[ops.length - 1]] >= precedence[token]) {
                applyOp();
            }
            ops.push(token);
        }
    }

    while (ops.length > 0) {
        applyOp();
    }

    return values[0] || 0;
}

export async function handleCalc(
    args: Record<string, unknown>
): Promise<{ result: number; expression: string; formatted: string }> {
    const expression = args.expression as string;

    if (!expression) {
        throw new Error("Expression is required");
    }

    try {
        const result = evaluateExpression(expression);

        return {
            expression,
            result,
            formatted:
                Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/\.?0+$/, ""),
        };
    } catch (error) {
        throw new Error(`Failed to evaluate: ${(error as Error).message}`);
    }
}

// Unit conversion
export async function handleConvert(
    args: Record<string, unknown>
): Promise<{ result: number; from: string; to: string }> {
    const value = args.value as number;
    const from = args.from as string;
    const to = args.to as string;

    type ConversionValue = number | ((v: number) => number);
    const conversions: Record<string, Record<string, ConversionValue>> = {
        // Length (base: meters)
        m: { km: 0.001, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701, mi: 0.000621371 },
        km: { m: 1000, cm: 100000, mm: 1000000, ft: 3280.84, in: 39370.1, mi: 0.621371 },
        ft: { m: 0.3048, km: 0.0003048, cm: 30.48, mm: 304.8, in: 12, mi: 0.000189394 },

        // Weight (base: kg)
        kg: { g: 1000, mg: 1000000, lb: 2.20462, oz: 35.274 },
        g: { kg: 0.001, mg: 1000, lb: 0.00220462, oz: 0.035274 },
        lb: { kg: 0.453592, g: 453.592, mg: 453592, oz: 16 },

        // Temperature
        c: { f: (v: number) => (v * 9) / 5 + 32, k: (v: number) => v + 273.15 },
        f: { c: (v: number) => ((v - 32) * 5) / 9, k: (v: number) => ((v - 32) * 5) / 9 + 273.15 },
        k: { c: (v: number) => v - 273.15, f: (v: number) => ((v - 273.15) * 9) / 5 + 32 },
    };

    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    if (!conversions[fromLower] || !conversions[fromLower][toLower]) {
        throw new Error(`Cannot convert from ${from} to ${to}`);
    }

    const conversion = conversions[fromLower][toLower];
    const result = typeof conversion === "function" ? conversion(value) : value * conversion;

    return { result, from, to };
}
