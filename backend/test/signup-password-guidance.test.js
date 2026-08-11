const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('backend', 'public', 'index.html');
const webApp = read('backend', 'public', 'app.js');
const styles = read('backend', 'public', 'styles.css');
const authRoute = read('backend', 'src', 'routes', 'auth.js');

test('l’inscription permet d’afficher le mot de passe sans perdre ses libellés accessibles', () => {
  const registerForm = html.match(/<form id="register-form"[\s\S]*?<\/form>/)?.[0] || '';

  assert.match(registerForm, /id="register-password"[^>]*type="password"[^>]*autocomplete="new-password"/);
  assert.match(registerForm, /id="register-password"[^>]*minlength="8"[^>]*maxlength="72"/);
  assert.match(registerForm, /aria-describedby="register-password-rules"/);
  assert.match(registerForm, /data-password-toggle="register-password"/);
  assert.match(registerForm, /aria-controls="register-password"/);
  assert.match(registerForm, /aria-pressed="false"/);
  assert.match(registerForm, /aria-label="Afficher le mot de passe">Afficher<\/button>/);

  assert.match(webApp, /input\.type = visible \? 'password' : 'text'/);
  assert.match(webApp, /button\.textContent = visible \? 'Afficher' : 'Masquer'/);
  assert.match(webApp, /button\.setAttribute\('aria-pressed', String\(!visible\)\)/);
  assert.match(webApp, /\$\$\('\[data-password-toggle\]'\)[\s\S]*togglePasswordVisibility\(button\)/);
});

test('les deux conditions réelles du mot de passe sont annoncées et mises à jour en direct', () => {
  const checklist = html.match(/<ul class="password-rules"[\s\S]*?<\/ul>/)?.[0] || '';

  assert.match(checklist, /id="register-password-rules"/);
  assert.match(checklist, /aria-label="Conditions du mot de passe"/);
  assert.match(checklist, /aria-live="polite"/);
  assert.equal((checklist.match(/data-password-rule=/g) || []).length, 2);
  assert.match(checklist, /data-password-rule="min"[\s\S]*Au moins 8 caractères/);
  assert.match(checklist, /data-password-rule="max"[\s\S]*72 caractères maximum/);
  assert.equal((checklist.match(/data-password-rule-status/g) || []).length, 2);

  assert.match(webApp, /const PASSWORD_MIN_LENGTH = 8/);
  assert.match(webApp, /const PASSWORD_MAX_LENGTH = 72/);
  assert.match(webApp, /registerPassword\.addEventListener\('input',[\s\S]*updatePasswordChecklist\(registerPassword\)/);
  assert.match(webApp, /rule\.classList\.toggle\('is-valid', respected\)/);
  assert.match(webApp, /rule\.classList\.toggle\('is-invalid', invalid\)/);
  assert.match(webApp, /'Respecté' : invalid \? 'Non respecté' : 'À respecter'/);
});

test('la politique affichée accepte uniquement les longueurs de 8 à 72 caractères', () => {
  const source = webApp.match(/function passwordPolicyState\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'la fonction de politique du mot de passe doit exister');

  const passwordPolicyState = Function(
    'PASSWORD_MIN_LENGTH',
    'PASSWORD_MAX_LENGTH',
    `${source}; return passwordPolicyState;`
  )(8, 72);

  assert.deepEqual(passwordPolicyState(''), { min: false, max: false });
  assert.deepEqual(passwordPolicyState('1234567'), { min: false, max: true });
  assert.deepEqual(passwordPolicyState('12345678'), { min: true, max: true });
  assert.deepEqual(passwordPolicyState('x'.repeat(72)), { min: true, max: true });
  assert.deepEqual(passwordPolicyState('x'.repeat(73)), { min: true, max: false });

  assert.match(authRoute, /typeof pw === 'string' && pw\.length >= 8 && pw\.length <= 72/);
  assert.equal((authRoute.match(/Mot de passe : entre 8 et 72 caractères/g) || []).length, 2);
  assert.match(html, /name="newPassword"[^>]*minlength="8"[^>]*maxlength="72"/);
});

test('les états respecté et non respecté restent visuellement distincts', () => {
  assert.match(styles, /\.form-stack \.password-field input \{[^}]*padding-right: 92px/);
  assert.match(styles, /\.password-toggle \{[\s\S]*?min-width: 76px;[\s\S]*?min-height: 36px;/);
  assert.match(styles, /\.password-rule\.is-valid \{[^}]*color: #086747;[^}]*background: #e8f6f0;/);
  assert.match(styles, /\.password-rule\.is-invalid \{[^}]*color: #a52f2f;[^}]*background: #fff0f0;/);
});
