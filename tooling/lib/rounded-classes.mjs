// @ts-check
// Finds the `rounded-*` utility classes in a source text that name no radius
// token. The web theme clears Tailwind's radius scale and defines the brand's
// own (brand/<name>/tokens.json `radius`), so a class outside it generates no
// CSS and the element renders square.

/** Corner and side prefixes Tailwind puts between `rounded` and the size. */
const DIRECTIONS = "(?:s|e|t|r|b|l|ss|se|ee|es|tl|tr|br|bl)";
const CLASS = /(?<![\w-])rounded(?:-(?:\[[^\]\s]+\]|[\w.%/-]+))?(?![\w-])/g;

/**
 * @param {string} text a source file
 * @param {string[]} tokens the radius token names
 * @returns {string[]} the classes that name no token, in order of appearance
 */
export function unknownRoundedClasses(text, tokens) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const direction = new RegExp(`^${DIRECTIONS}-`);
  return [...code.matchAll(CLASS)]
    .map((m) => m[0])
    .filter((cls) => {
      const size = cls.slice("rounded-".length);
      if (cls === "rounded") return true;
      if (size === "none" || size === "full" || size.startsWith("[")) return false;
      const bare = size.replace(direction, "");
      if (bare === "none" || bare === "full" || bare.startsWith("[")) return false;
      return !tokens.includes(size) && !tokens.includes(bare);
    });
}
