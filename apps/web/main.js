/*
 * Waitlist form behaviour for the personal-color-kr landing page.
 *
 * Progressive enhancement: the page is fully readable without JS; this only
 * adds client-side email validation + submission to the waitlist endpoint.
 *
 * BEFORE GOING LIVE: set WAITLIST_ENDPOINT to a real collector — e.g. a
 * Formspree form URL ("https://formspree.io/f/<id>") or your own backend that
 * accepts `POST { email }`. Until it is set, a valid submit shows an honest
 * "준비 중" message and does NOT claim the address was saved.
 */
const WAITLIST_ENDPOINT = ''; // TODO: set before deploy (Formspree URL or own endpoint)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  invalid: '올바른 이메일 주소를 입력해주세요.',
  pending: '등록 중...',
  notReady: '사전 등록이 곧 열려요. 조금만 기다려주세요.',
  ok: '등록됐어요. 출시되면 가장 먼저 알려드릴게요!',
  error: '잠시 후 다시 시도해주세요.',
};

/**
 * Submit one email address to the configured waitlist endpoint.
 * @returns {Promise<'ok'|'notReady'|'error'>}
 */
async function submitEmail(email) {
  if (WAITLIST_ENDPOINT === '') {
    return 'notReady';
  }
  try {
    const res = await fetch(WAITLIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email }),
    });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/** Wire a single waitlist form: validate, submit, reflect status honestly. */
function wireForm(formId, inputId, statusId) {
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (form === null || input === null || status === null) {
    return;
  }
  const button = form.querySelector('button[type="submit"]');

  function setStatus(message, isOk) {
    status.textContent = message;
    status.classList.toggle('waitlist__status--ok', isOk === true);
  }

  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!EMAIL_RE.test(email)) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      setStatus(MESSAGES.invalid, false);
      return;
    }

    if (button !== null) {
      button.disabled = true;
    }
    setStatus(MESSAGES.pending, false);

    const result = await submitEmail(email);

    if (button !== null) {
      button.disabled = false;
    }

    if (result === 'ok') {
      form.reset();
      setStatus(MESSAGES.ok, true);
    } else if (result === 'notReady') {
      setStatus(MESSAGES.notReady, false);
    } else {
      setStatus(MESSAGES.error, false);
    }
  });
}

wireForm('waitlist-form', 'email-hero', 'waitlist-status');
wireForm('waitlist-form-foot', 'email-foot', 'waitlist-status-foot');
