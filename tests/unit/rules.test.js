import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkAnswers, checkPhotos, hasValidSignature, photoBytes } from '../../server/domain/answers.js';
import { fakePhoto } from '../helpers.js';
import { isTooFarInFuture, shouldApply } from '../../server/domain/conflict.js';
import { canTransition, isLockedForInspector } from '../../server/domain/stateMachine.js';
import { nextDelayMs } from '../../server/registry/backoff.js';
import { parseRetryAfter } from '../../server/registry/client.js';

import { hashPassword, verifyPassword } from '../../server/security/passwords.js';
import { hashToken } from '../../server/security/tokens.js';

const STATES = [null, 'assigned', 'in_progress', 'submitted', 'returned', 'approved'];

// Tabelul din docs/requirements.md, secțiunea 5.
const ALLOWED = new Set([
  'coordinator:null:assigned',
  'coordinator:submitted:approved',
  'coordinator:submitted:returned',
  'inspector:null:in_progress',
  'inspector:null:submitted',
  ...['assigned', 'in_progress', 'returned'].flatMap((from) => [`inspector:${from}:in_progress`, `inspector:${from}:submitted`])
]);

describe('T-STATE-01/02 mașina de stări', () => {
  for (const role of ['coordinator', 'inspector']) {
    for (const from of STATES) {
      for (const to of STATES.slice(1)) {
        const key = `${role}:${from}:${to}`;
        test(`${role}: ${from ?? '(nou)'} → ${to} ${ALLOWED.has(key) ? 'permis' : 'respins'}`, () => {
          assert.equal(canTransition(from, to, role), ALLOWED.has(key));
        });
      }
    }
  }

  test('un rol necunoscut nu are nicio tranziție', () => {
    assert.equal(canTransition('submitted', 'approved', 'admin'), false);
  });

  test('doar submitted și approved sunt blocate pentru inspector', () => {
    assert.deepEqual(STATES.slice(1).filter(isLockedForInspector), ['submitted', 'approved']);
  });
});

describe('T-CONF-01 regula de conflict', () => {
  test('o modificare mai nouă se aplică', () => {
    assert.equal(shouldApply('2026-11-20T10:00:01Z', '2026-11-20T10:00:00Z'), true);
  });
  test('o modificare mai veche se ignoră', () => {
    assert.equal(shouldApply('2026-11-20T09:59:59Z', '2026-11-20T10:00:00Z'), false);
  });
  test('la egalitate (duplicat) se ignoră', () => {
    assert.equal(shouldApply('2026-11-20T10:00:00Z', new Date('2026-11-20T10:00:00Z')), false);
  });
  test('R8: peste 5 minute în viitor e respins, sub 5 minute e acceptat', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    assert.equal(isTooFarInFuture('2026-11-20T10:05:01Z', now), true);
    assert.equal(isTooFarInFuture('2026-11-20T10:04:59Z', now), false);
  });
});

describe('validarea răspunsurilor și a pozelor', () => {
  const template = { questions: [{ id: 'q1' }, { id: 'q2' }] };

  test('răspuns la o întrebare inexistentă', () => {
    assert.deepEqual(checkAnswers(template, { q9: { value: 'pass' } }, false).map((p) => p.path), ['answers.q9']);
  });
  test('la trimitere, întrebările fără răspuns sunt raportate', () => {
    assert.deepEqual(checkAnswers(template, { q1: { value: 'pass' } }, true).map((p) => p.path), ['answers.q2']);
  });
  test('răspunsuri parțiale sunt acceptate cât inspecția e în lucru', () => {
    assert.deepEqual(checkAnswers(template, { q1: { value: 'pass' } }, false), []);
  });
  test('mărimea pozei se calculează din base64, cu sau fără padding', () => {
    assert.equal(photoBytes(`data:image/png;base64,${Buffer.alloc(10).toString('base64')}`), 10);
    assert.equal(photoBytes(`data:image/png;base64,${Buffer.alloc(11).toString('base64')}`), 11);
    assert.equal(photoBytes(`data:image/png;base64,${Buffer.alloc(12).toString('base64')}`), 12);
  });
  test('o poză peste 200 KB e respinsă, una de 200 KB e acceptată', () => {
    assert.deepEqual(checkPhotos([fakePhoto(200 * 1024)]), []);
    assert.deepEqual(checkPhotos([fakePhoto(200 * 1024), fakePhoto(200 * 1024 + 1)]).map((p) => p.path), ['photos.1']);
  });
  test('semnătura fișierului trebuie să corespundă tipului declarat', () => {
    assert.equal(hasValidSignature(fakePhoto(10, 'jpeg')), true);
    assert.equal(hasValidSignature(fakePhoto(10, 'png')), true);
    assert.equal(hasValidSignature(fakePhoto(10, 'jpeg').replace('image/jpeg', 'image/png')), false);
    assert.equal(hasValidSignature('data:image/gif;base64,R0lGOD'), false);
  });
});

describe('T-EXT-13 backoff și Retry-After', () => {
  const base = { baseDelayMs: 1000, maxRetryAfterMs: 600000 };
  test('backoff exponențial: 1 s, 2 s, 4 s, 8 s', () => {
    assert.deepEqual([1, 2, 3, 4].map((attempt) => nextDelayMs({ ...base, attempt, retryAfterMs: null })), [1000, 2000, 4000, 8000]);
  });
  test('Retry-After are prioritate față de backoff', () => {
    assert.equal(nextDelayMs({ ...base, attempt: 3, retryAfterMs: 1500 }), 1500);
  });
  test('Retry-After e respectat și peste 30 s, dar plafonat la 10 minute', () => {
    assert.equal(nextDelayMs({ ...base, attempt: 1, retryAfterMs: 120_000 }), 120_000);
    assert.equal(nextDelayMs({ ...base, attempt: 1, retryAfterMs: 86_400_000 }), 600_000);
  });
});

describe('antetul Retry-After', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  test('secunde, dată HTTP, lipsă sau invalid', () => {
    assert.equal(parseRetryAfter('120', now), 120_000);
    assert.equal(parseRetryAfter('Fri, 20 Nov 2026 10:00:30 GMT', now), 30_000);
    assert.equal(parseRetryAfter('Fri, 20 Nov 2026 09:59:00 GMT', now), 0);
    assert.equal(parseRetryAfter(null, now), null);
    assert.equal(parseRetryAfter('', now), null);
    assert.equal(parseRetryAfter('curând', now), null);
  });
});

describe('T-AUTH-06 parole și tokenuri', () => {
  test('aceeași parolă dă hash-uri diferite (sare), iar verificarea funcționează', async () => {
    const a = await hashPassword('secret123');
    const b = await hashPassword('secret123');
    assert.notEqual(a, b);
    assert.ok(!a.includes('secret123'));
    assert.equal(await verifyPassword('secret123', a), true);
    assert.equal(await verifyPassword('gresit', a), false);
  });
  test('un hash în format greșit nu e acceptat', async () => {
    assert.equal(await verifyPassword('x', 'md5$abc'), false);
  });
  test('tokenul se păstrează ca SHA-256 (64 de caractere hex)', () => {
    assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
  });
});
