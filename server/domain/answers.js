// Verificări care depind de șablon și nu pot fi exprimate doar în schema Joi (R7).

export const MAX_PHOTO_BYTES = 200 * 1024;

// Răspunsurile trebuie să se refere doar la întrebări din șablon; la trimiterea spre revizie,
// toate întrebările trebuie să aibă răspuns. Întoarce lista problemelor (goală = valid).
export function checkAnswers(template, answers, requireComplete) {
  const questionIds = new Set(template.questions.map((q) => q.id));
  const problems = [];

  for (const id of Object.keys(answers)) {
    if (!questionIds.has(id)) problems.push({ path: `answers.${id}`, message: 'Întrebarea nu există în șablon' });
  }
  if (requireComplete) {
    for (const id of questionIds) {
      if (!answers[id]) problems.push({ path: `answers.${id}`, message: 'Întrebarea nu are răspuns' });
    }
  }
  return problems;
}

// Mărimea imaginii decodate dintr-un data URL base64.
export function photoBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Primii octeți ai fișierului („semnătura”): un JPEG începe cu FF D8 FF, un PNG cu 89 50 4E 47.
const SIGNATURES = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] };

export function hasValidSignature(dataUrl) {
  const type = /^data:image\/(jpeg|png);base64,/.exec(dataUrl)?.[1];
  if (!type) return false;
  const head = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 13), 'base64');
  return SIGNATURES[type].every((byte, i) => head[i] === byte);
}

export function checkPhotos(photos) {
  const problems = [];
  photos.forEach((photo, index) => {
    const bytes = photoBytes(photo);
    if (!hasValidSignature(photo)) problems.push({ path: `photos.${index}`, message: 'Conținutul nu e o imagine JPEG sau PNG' });
    else if (bytes > MAX_PHOTO_BYTES) problems.push({ path: `photos.${index}`, message: `Poza are ${Math.round(bytes / 1024)} KB; maximum 200 KB` });
  });
  return problems;
}
