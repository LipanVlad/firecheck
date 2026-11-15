export const STATUS_LABELS = {
  assigned: 'Asignată',
  in_progress: 'În lucru',
  submitted: 'Trimisă spre revizie',
  returned: 'Returnată',
  approved: 'Aprobată'
};

export const ANSWER_LABELS = { pass: 'Conform', fail: 'Neconform', na: 'N/A' };

export const REGISTRY_LABELS = {
  pending: 'În așteptare',
  sending: 'Se trimite',
  sent: 'Înregistrată',
  failed: 'Eșuată'
};

export const formatDate = (value) => (value ? new Date(value).toLocaleDateString('ro-RO') : '—');
export const formatDateTime = (value) => (value ? new Date(value).toLocaleString('ro-RO') : '—');
