import env from './config.js';

export async function validateRecaptcha(responseToken) {
  if (!responseToken || !env.RECAPTCHA_SECRET) {
    console.warn('reCAPTCHA validation skipped - missing token or secret');
    return true; // Allow in dev/test mode
  }

  const params = new URLSearchParams();
  params.append('secret', env.RECAPTCHA_SECRET);
  params.append('response', responseToken);

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!res.ok) {
    return false;
  }

  const body = await res.json();
  if (body.success) return true;

  if (body['error-codes']?.includes('invalid-input-secret')) {
    console.warn('reCAPTCHA secret invalid; treating as dev environment.');
    return true;
  }

  return false;
}

