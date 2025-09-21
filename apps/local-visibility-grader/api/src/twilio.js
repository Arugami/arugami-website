import twilio from 'twilio';
import env from './config.js';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, {
  lazyLoading: true
});

export async function startPhoneVerification(phone) {
  const verification = await client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verifications.create({
    to: phone,
    channel: 'sms'
  });

  return verification.status;
}

export async function checkPhoneVerification(phone, code) {
  const check = await client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({
    to: phone,
    code
  });

  return check.status === 'approved';
}
