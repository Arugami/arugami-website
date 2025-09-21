import env from './config.js';

export async function validateRecaptcha(responseToken) {
  if (!responseToken) {
    return false;
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
  return Boolean(body.success);
}
