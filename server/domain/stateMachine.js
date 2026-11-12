// Mașina de stări a inspecției (docs/requirements.md, secțiunea 5).
// Toate regulile de tranziție stau aici, într-un singur loc, nu împrăștiate prin rute.

// null = inspecția nu există încă (creare).
const TRANSITIONS = {
  coordinator: {
    null: ['assigned'],
    submitted: ['approved', 'returned']
  },
  inspector: {
    null: ['in_progress', 'submitted'],
    assigned: ['in_progress', 'submitted'],
    in_progress: ['in_progress', 'submitted'],
    returned: ['in_progress', 'submitted']
  }
};

const LOCKED_FOR_INSPECTOR = new Set(['submitted', 'approved']);

export function canTransition(from, to, role) {
  const allowed = TRANSITIONS[role]?.[from ?? 'null'] ?? [];
  return allowed.includes(to);
}

// O inspecție în revizie sau aprobată nu mai poate fi modificată de inspector (R3).
export function isLockedForInspector(status) {
  return LOCKED_FOR_INSPECTOR.has(status);
}
