// Politica de conflicte (R2): ultima modificare câștigă, după momentul în care inspectorul a
// făcut-o pe dispozitivul lui (clientUpdatedAt).
//
// Se aplică doar o modificare STRICT mai nouă decât cea salvată. Consecințe:
// - o cerere duplicată (același clientUpdatedAt) nu are niciun efect (R1);
// - o cerere veche, reîncercată târziu, nu suprascrie una nouă;
// - la egalitate rămâne varianta deja salvată.
export function shouldApply(incoming, stored) {
  return new Date(incoming).getTime() > new Date(stored).getTime();
}

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// R8: un marcaj de timp cu peste 5 minute în viitor e respins, altfel un ceas dat înainte
// ar câștiga mereu conflictele.
export function isTooFarInFuture(clientUpdatedAt, now = new Date()) {
  return new Date(clientUpdatedAt).getTime() > now.getTime() + MAX_CLOCK_SKEW_MS;
}
