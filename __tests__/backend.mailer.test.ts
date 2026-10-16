// __tests__/backend.mailer.test.ts
// Email templates must escape user-supplied text — org names and contact
// names arrive from the unauthenticated org-application form.

import { escapeHtml, orgApplicationReceivedTemplate, weeklyDigestTemplate } from '../backend/mailer';

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('McKendree University')).toBe('McKendree University');
  });
});

describe('email templates', () => {
  it('escapes org and contact names from the public application form', () => {
    const html = orgApplicationReceivedTemplate({
      contactName: '<b>Mallory</b> Smith',
      orgName: '<a href="https://evil.example">Click me</a>',
    });
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).not.toContain('<b>Mallory</b>');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
  });

  it('escapes stop names and AI narrative in the weekly digest', () => {
    const html = weeklyDigestTemplate({
      adminName: 'Ada Admin',
      orgName: 'Test U',
      totalBoardings: 12,
      activeDrivers: 2,
      topStop: '<img src=x onerror=alert(1)> (5 boardings)',
      narrative: 'Ridership <script>steady</script>.',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
});
