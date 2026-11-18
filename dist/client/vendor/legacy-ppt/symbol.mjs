// Adobe Symbol encoding, indexed by the two nibbles of the legacy byte. See ADOBE-SYMBOL.txt.
const rows = [
  "����������������",
  "����������������",
  " !∀#∃%&∋()∗+,−./",
  "0123456789:;<=>?",
  "≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟ",
  "ΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_",
  "�αβχδεφγηιϕκλµνο",
  "πθρστυϖωξψζ{|}∼�",
  "����������������",
  "����������������",
  "€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓",
  "°±″≥×∝∂•÷≠≡≈…��↵",
  "ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉",
  "∠∇���∏√⋅¬∧∨⇔⇐⇑⇒⇓",
  "◊〈���∑����������",
  "�〉∫⌠�⌡����������"
];

export function decodeSymbolText(text, font) {
  if (font?.toLowerCase() !== "symbol") return text;
  return text.replace(/[\uf000-\uf0ff]/g, character => {
    const byte = character.charCodeAt(0) - 0xf000;
    const mapped = rows[byte >> 4][byte & 15];
    return mapped === "�" ? character : mapped;
  });
}