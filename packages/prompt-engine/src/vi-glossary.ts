/**
 * Vietnamese glossary — real, deterministic vocabulary-based translation for
 * the app's own CLOSED vocabularies (docs/07 Scenario, camera/lighting
 * classification terms, structural-constraint phrases). This is NOT a
 * general-purpose translator and never claims to be one (CLAUDE.md rule 7):
 * it only ever returns a real Vietnamese phrase for a term the app itself
 * defines. Freeform text (a Vision Analysis description sentence, for
 * example) is never passed through here — `mirrorAsPromptFieldValue`
 * (prompt-intelligence.ts) handles that honestly, with an explicit warning.
 */
const GLOSSARY: Readonly<Record<string, string>> = {
  // Scenario contexts (docs/07)
  residential: 'khu dân cư',
  'luxury villa': 'biệt thự cao cấp',
  urban: 'đô thị',
  resort: 'khu nghỉ dưỡng',
  tropical: 'nhiệt đới',
  coastal: 'ven biển',
  forest: 'rừng',
  mountain: 'núi',
  commercial: 'thương mại',
  custom: 'tùy chỉnh',

  // Scenario lighting
  morning: 'buổi sáng',
  midday: 'giữa trưa',
  afternoon: 'buổi chiều',
  'golden hour': 'giờ vàng',
  sunset: 'hoàng hôn',
  'blue hour': 'giờ xanh',
  night: 'ban đêm',
  overcast: 'trời nhiều mây',
  studio: 'ánh sáng studio',

  // Sun directions
  front: 'phía trước',
  back: 'phía sau',
  left: 'bên trái',
  right: 'bên phải',
  side: 'bên hông',
  top: 'trên cao',
  auto: 'tự động',

  // Environments
  'clear sky': 'bầu trời quang đãng',
  cloudy: 'nhiều mây',
  garden: 'khu vườn',
  minimal: 'tối giản',
  cinematic: 'điện ảnh',

  // Camera modes
  'preserve original': 'giữ nguyên góc máy gốc',
  wide: 'góc rộng',
  standard: 'tiêu chuẩn',
  telephoto: 'ống kính tele',
  architectural: 'kiến trúc',
  'eye level': 'ngang tầm mắt',
  low: 'góc thấp',
  high: 'góc cao',

  // Resolutions / render cores
  preview: 'xem trước',
  '2k': '2K',
  '4k': '4K',
  '6k': '6K',
  '8k/ultra': '8K/Siêu nét',
  'nano banana': 'Nano Banana',
  'google flow': 'Google Flow',
  'chatgpt image': 'ChatGPT Image',

  // Camera lens characteristics / perspective types (camera-intelligence.ts)
  'wide-angle': 'góc rộng',
  orthographic: 'trực giao',
  'one-point': 'phối cảnh một điểm tụ',
  'two-point': 'phối cảnh hai điểm tụ',
  'three-point': 'phối cảnh ba điểm tụ',

  // Lighting mood tags (lighting-intelligence.ts)
  'clear-light': 'ánh sáng trong trẻo',
  'sunlight-filtering-through-canopy': 'ánh nắng xuyên qua tán lá',
  'dappled-light-on-surfaces': 'ánh sáng lốm đốm trên bề mặt',
  'evocative-shadows': 'bóng đổ giàu cảm xúc',
  'cinematic-lighting': 'ánh sáng điện ảnh',

  // Exposure profile terms
  controlled: 'được kiểm soát',
  detailed: 'chi tiết rõ nét',
  clean: 'sạch',
  'medium-high': 'trung bình khá cao',

  // Structural-constraint / realism fixed phrases
  'real-life photography': 'ảnh chụp thực tế',
  photorealistic: 'chân thực như ảnh chụp',
  'not applicable': 'không áp dụng',

  // Common style names (gemini-vision-engine.ts prompt vocabulary)
  modern: 'hiện đại',
  contemporary: 'đương đại',
  'modern contemporary': 'hiện đại đương đại',
  minimalism: 'tối giản',
  japandi: 'japandi',
  luxury: 'sang trọng',
  'wabi sabi': 'wabi sabi',
  scandinavian: 'scandinavian',
  neo: 'tân',
  'neo classic': 'tân cổ điển',
};

/** Case/whitespace-insensitive lookup. Returns null (never a guess) when the term isn't in the closed vocabulary above. */
export function translateKnownTerm(value: string): string | null {
  return GLOSSARY[value.trim().toLowerCase()] ?? null;
}

/**
 * Translates a term for display, falling back to the original English value
 * when it isn't in the closed vocabulary — never blank, never a fabricated
 * guess. Callers that need to know whether a real translation happened
 * should use `translateKnownTerm` directly instead.
 */
export function translateOrMirror(value: string): string {
  return translateKnownTerm(value) ?? value;
}
