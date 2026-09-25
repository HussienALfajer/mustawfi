/**
 * Project lint rules (ADR-0015 rule 6, ADR-0018, ADR-0023, ADR-0024).
 *
 * - `no-float-money`: money never passes through a JavaScript `number`.
 * - `no-ambient-clock`: the time comes from an injected `Clock`.
 * - `no-ambient-randomness`: randomness comes from an injected `RandomSource` or `IdGenerator`.
 * - `no-physical-direction`: the RTL interface uses logical CSS only (ADR-0024).
 * - `no-literal-string`: user-facing text comes from i18n keys (ADR-0023).
 */

/** @typedef {import("eslint").Rule.RuleModule} RuleModule */
/** @typedef {import("eslint").Rule.RuleContext} RuleContext */
/** @typedef {import("estree").Node} Node */
/** @typedef {import("estree").Expression | import("estree").Super} Callee */

/**
 * Whether `name` at `node` refers to the global binding, not a local variable or import.
 * @param {RuleContext} context
 * @param {Node} node
 * @param {string} name
 */
function isGlobal(context, node, name) {
  /** @type {import("eslint").Scope.Scope | null} */
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(name);
    if (variable) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

/**
 * The global object a member expression reads from, seeing through `globalThis.X`,
 * `window.X`, and `self.X`: `Math` for `Math.round`, `crypto` for `globalThis.crypto.randomUUID`.
 * @param {RuleContext} context
 * @param {Node} object
 * @returns {string | undefined}
 */
function globalObjectName(context, object) {
  if (object.type === "Identifier") {
    return isGlobal(context, object, object.name) ? object.name : undefined;
  }
  if (
    object.type === "MemberExpression" &&
    !object.computed &&
    object.property.type === "Identifier" &&
    object.object.type === "Identifier" &&
    ["globalThis", "window", "self"].includes(object.object.name) &&
    isGlobal(context, object.object, object.object.name)
  ) {
    return object.property.name;
  }
  return undefined;
}

/**
 * `[object, property]` when `node` is `object.property` on a global object, else undefined.
 * @param {RuleContext} context
 * @param {Node} node
 * @returns {[string, string] | undefined}
 */
function globalMember(context, node) {
  if (node.type !== "MemberExpression") return undefined;
  const property =
    !node.computed && node.property.type === "Identifier"
      ? node.property.name
      : node.property.type === "Literal" && typeof node.property.value === "string"
        ? node.property.value
        : undefined;
  if (property === undefined) return undefined;
  const object = globalObjectName(context, node.object);
  return object === undefined ? undefined : [object, property];
}

/**
 * The global function a call targets: `Number` for `Number(x)` or `globalThis.Number(x)`.
 * @param {RuleContext} context
 * @param {Callee} callee
 */
function globalFunctionName(context, callee) {
  if (callee.type === "Super") return undefined;
  if (callee.type === "Identifier") {
    return isGlobal(context, callee, callee.name) ? callee.name : undefined;
  }
  const member = globalMember(context, callee);
  return member && ["globalThis", "window", "self"].includes(member[0]) ? member[1] : undefined;
}

/**
 * @param {import("estree").ImportDeclaration} node
 * @returns {string | undefined}
 */
function importSource(node) {
  return typeof node.source.value === "string" ? node.source.value : undefined;
}

const MONEY_ADRS = "Use Decimal/Money from @mustawfi/kernel (ADR-0018).";
const DECIMAL_LIBRARIES = new Set(["decimal.js", "decimal.js-light", "big.js", "bignumber.js"]);

/** @type {RuleModule} */
const noFloatMoney = {
  meta: {
    type: "problem",
    docs: { description: "Money never passes through a JavaScript number (ADR-0018)." },
    schema: [
      {
        type: "object",
        properties: { allowDecimalLibrary: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      parse: "`{{name}}` turns text into a float. " + MONEY_ADRS,
      toFixed: "`.{{name}}()` rounds through a float. " + MONEY_ADRS,
      mathRound: "`Math.round` rounds a float with an unnamed mode. " + MONEY_ADRS,
      decimalLibrary:
        "Only @mustawfi/kernel wraps `{{name}}`; use its Decimal so rounding stays explicit (ADR-0018).",
    },
  },
  create(context) {
    const [options = {}] = /** @type {[{ allowDecimalLibrary?: boolean }?]} */ (context.options);
    return {
      CallExpression(node) {
        const name = globalFunctionName(context, node.callee);
        if (name === "parseFloat" || name === "Number") {
          context.report({ node, messageId: "parse", data: { name } });
          return;
        }
        const member = globalMember(context, node.callee);
        if (member?.[0] === "Number" && member[1] === "parseFloat") {
          context.report({ node, messageId: "parse", data: { name: "Number.parseFloat" } });
        } else if (member?.[0] === "Math" && member[1] === "round") {
          context.report({ node, messageId: "mathRound" });
        } else if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier" &&
          ["toFixed", "toPrecision"].includes(node.callee.property.name)
        ) {
          context.report({ node, messageId: "toFixed", data: { name: node.callee.property.name } });
        }
      },
      NewExpression(node) {
        if (globalFunctionName(context, node.callee) === "Number") {
          context.report({ node, messageId: "parse", data: { name: "new Number" } });
        }
      },
      ImportDeclaration(node) {
        const source = importSource(node);
        if (source && DECIMAL_LIBRARIES.has(source) && !options.allowDecimalLibrary) {
          context.report({ node, messageId: "decimalLibrary", data: { name: source } });
        }
      },
    };
  },
};

const CLOCK_ADR = "Take a `Clock` from @mustawfi/kernel as a dependency (ADR-0015 rule 6).";

/** @type {RuleModule} */
const noAmbientClock = {
  meta: {
    type: "problem",
    docs: { description: "Domain code reads the time only from an injected Clock." },
    schema: [],
    messages: {
      ambient: "`{{name}}` reads the ambient clock. " + CLOCK_ADR,
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const member = globalMember(context, node);
        if (!member) return;
        const [object, property] = member;
        if (
          (object === "Date" && property === "now") ||
          (object === "performance" && property === "now") ||
          (object === "Temporal" && property === "Now")
        ) {
          context.report({ node, messageId: "ambient", data: { name: `${object}.${property}` } });
        }
      },
      NewExpression(node) {
        if (globalFunctionName(context, node.callee) === "Date" && node.arguments.length === 0) {
          context.report({ node, messageId: "ambient", data: { name: "new Date()" } });
        }
      },
      CallExpression(node) {
        // `Date()` without `new` returns the current time as text, whatever its arguments.
        if (globalFunctionName(context, node.callee) === "Date") {
          context.report({ node, messageId: "ambient", data: { name: "Date()" } });
        }
      },
    };
  },
};

const RANDOM_ADR =
  "Take a `RandomSource` or `IdGenerator` from @mustawfi/kernel as a dependency (ADR-0015 rule 6).";
const NODE_RANDOM_EXPORTS = new Set([
  "getRandomValues",
  "randomBytes",
  "randomFill",
  "randomFillSync",
  "randomInt",
  "randomUUID",
  "webcrypto",
]);

/** @type {RuleModule} */
const noAmbientRandomness = {
  meta: {
    type: "problem",
    docs: { description: "Domain code gets randomness only from an injected source." },
    schema: [],
    messages: {
      ambient: "`{{name}}` is ambient randomness. " + RANDOM_ADR,
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const member = globalMember(context, node);
        if (!member) return;
        const [object, property] = member;
        if (
          (object === "Math" && property === "random") ||
          (object === "crypto" && (property === "randomUUID" || property === "getRandomValues"))
        ) {
          context.report({ node, messageId: "ambient", data: { name: `${object}.${property}` } });
        }
      },
      ImportDeclaration(node) {
        const source = importSource(node);
        if (source !== "crypto" && source !== "node:crypto") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            NODE_RANDOM_EXPORTS.has(specifier.imported.name)
          ) {
            context.report({
              node: specifier,
              messageId: "ambient",
              data: { name: `${source}.${specifier.imported.name}` },
            });
          }
        }
      },
    };
  },
};

const RTL_ADR = "Use the logical form (ADR-0024: RTL is the default, not a mode).";

/**
 * Tailwind utilities, and the bare values `left` and `right`, that name a physical side. Their logical forms are `ms-`/`me-`,
 * `ps-`/`pe-`, `start-`/`end-`, `border-s`/`border-e`, `rounded-s`/`rounded-e`,
 * `text-start`/`text-end`, `float-start`/`float-end`.
 */
const PHYSICAL_UTILITY =
  /^-?(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-(?:tl|tr|bl|br))(?:-|$)|^(?:text|float|clear)-(?:left|right)$/;

/** CSS properties (React style keys) that name a physical side. */
const PHYSICAL_PROPERTY =
  /^(?:(?:margin|padding|border|scrollMargin|scrollPadding)(?:Left|Right)\w*|border(?:Top|Bottom)(?:Left|Right)Radius|left|right)$/;

/**
 * The physical utilities in a class string: variants (`hover:`, `md:`) and the important
 * mark are stripped before matching.
 * @param {string} text
 */
function physicalUtilities(text) {
  return text
    .split(/\s+/)
    .map((token) => token.split(":").at(-1)?.replace(/^!|!$/g, "") ?? "")
    .filter((token) => PHYSICAL_UTILITY.test(token));
}

/**
 * Whether `node` sits inside a JSX `style={…}` attribute.
 * @param {RuleContext} context
 * @param {Node} node
 */
function inStyleAttribute(context, node) {
  return context.sourceCode
    .getAncestors(node)
    .some(
      (ancestor) =>
        /** @type {{ type: string }} */ (ancestor).type === "JSXAttribute" &&
        /** @type {any} */ (ancestor).name?.name === "style",
    );
}

/** @type {RuleModule} */
const noPhysicalDirection = {
  meta: {
    type: "problem",
    docs: { description: "No physical-direction CSS in the RTL user interface (ADR-0024)." },
    schema: [],
    messages: {
      utility: "`{{name}}` names a physical side. " + RTL_ADR,
      property: "`{{name}}` names a physical side. " + RTL_ADR,
    },
  },
  create(context) {
    /**
     * @param {Node} node
     * @param {string} text
     */
    function checkClasses(node, text) {
      for (const name of physicalUtilities(text)) {
        context.report({ node, messageId: "utility", data: { name } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const parent = /** @type {{ type: string }} */ (/** @type {any} */ (node).parent);
        if (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration") return;
        checkClasses(node, node.value);
      },
      TemplateElement(node) {
        checkClasses(node, node.value.cooked ?? node.value.raw);
      },
      Property(node) {
        if (!inStyleAttribute(context, node)) return;
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal" && typeof node.key.value === "string"
              ? node.key.value
              : undefined;
        if (key === undefined) return;
        // A `"left"`/`"right"` value (`textAlign`, `float`) is caught as a string above.
        if (PHYSICAL_PROPERTY.test(key)) {
          context.report({ node: node.key, messageId: "property", data: { name: key } });
        }
      },
    };
  },
};

const I18N_ADR =
  "Put user-facing text in the module's i18n namespace and render it with `t()` (ADR-0023).";

/** JSX attributes whose value a person reads or hears. */
const USER_FACING_ATTRIBUTES = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "description",
  "errorMessage",
  "label",
  "placeholder",
  "title",
]);

/** Text a person would read: any letter in any script. Digits and punctuation pass. */
const WORDS = /\p{L}/u;

/**
 * The literal text of a JSX child or attribute value, when it is a plain string.
 * @param {any} node
 * @returns {string | undefined}
 */
function literalText(node) {
  if (node === null || node === undefined) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((/** @type {any} */ quasi) => quasi.value.cooked ?? "").join(" ");
  }
  if (node.type === "JSXExpressionContainer") return literalText(node.expression);
  return undefined;
}

/** @type {RuleModule} */
const noLiteralString = {
  meta: {
    type: "problem",
    docs: { description: "No hard-coded user-facing strings in the interface (ADR-0023)." },
    schema: [],
    messages: {
      text: "Literal text {{text}} in JSX. " + I18N_ADR,
      attribute: "Literal `{{name}}` text {{text}}. " + I18N_ADR,
    },
  },
  create(context) {
    /** @param {string} text */
    const quote = (text) => JSON.stringify(text.trim().slice(0, 30));
    return {
      /** @param {any} node */
      JSXText(node) {
        if (WORDS.test(node.value)) {
          context.report({ node, messageId: "text", data: { text: quote(node.value) } });
        }
      },
      /** @param {any} node */
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXElement" && node.parent.type !== "JSXFragment") return;
        const text = literalText(node.expression);
        if (text !== undefined && WORDS.test(text)) {
          context.report({ node, messageId: "text", data: { text: quote(text) } });
        }
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : undefined;
        if (name === undefined || !USER_FACING_ATTRIBUTES.has(name)) return;
        const text = literalText(node.value);
        if (text !== undefined && WORDS.test(text)) {
          context.report({ node, messageId: "attribute", data: { name, text: quote(text) } });
        }
      },
    };
  },
};

export const plugin = {
  meta: { name: "@mustawfi/eslint-plugin" },
  rules: {
    "no-float-money": noFloatMoney,
    "no-ambient-clock": noAmbientClock,
    "no-ambient-randomness": noAmbientRandomness,
    "no-physical-direction": noPhysicalDirection,
    "no-literal-string": noLiteralString,
  },
};
