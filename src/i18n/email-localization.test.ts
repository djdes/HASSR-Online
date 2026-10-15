import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import {
  sendVerificationEmail, sendInviteTokenEmail, sendInviteEmail, sendAccountPasswordEmail,
  sendPasswordChangedEmail, sendPasswordResetEmail, sendWelcomeEmail, sendNewDeviceLoginEmail,
  sendInvoiceEmail, sendPaymentReceiptEmail, sendFeedbackAdminEmail, sendFeedbackReplyEmail,
  sendPlatformAdminTestEmail, sendDeviationAlertEmail, sendComplianceReminderEmail, sendTemperatureAlertEmail,
} from "../lib/email";
import { loadMessages } from "./messages";

test("localized email templates use the recipient language and escape data without contacting SMTP", async (context) => {
  const sent: Array<{ to: string; subject: string; html: string; attachments?: Array<{ contentType?: string; filename: string }> }> = [];
  context.mock.method(nodemailer, "createTransport", () => ({ sendMail: async (message: typeof sent[number]) => { sent.push(message); } }));
  const previousHost = process.env.SMTP_HOST;
  process.env.SMTP_HOST = "smtp.example.invalid";
  context.after(() => {
    if (previousHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previousHost;
  });
  const to = "test@example.invalid";
  const name = '<img src="x" onerror="bad">';
  const organizationName = "O‘tkir & Partners <img src=x>";
  const password = "<test>&password";
  for (const locale of ["ru", "en", "uz"] as const) {
    const start = sent.length;
    const m = await loadMessages(locale);
    await sendVerificationEmail(to, "123456", locale);
    await sendInviteTokenEmail({ to, name, organizationName, inviteUrl: "https://wesetup.ru/invite/test?one=1&two=2", locale });
    await sendInviteEmail({ to, name, password, organizationName, locale });
    await sendAccountPasswordEmail({ to, password, locale });
    await sendPasswordChangedEmail({ to, password, locale });
    await sendPasswordResetEmail({ to, resetUrl: "https://wesetup.ru/reset-password?token=fixture&source=email", locale });
    await sendWelcomeEmail({ to, name, organizationName, locale });
    await sendNewDeviceLoginEmail({ to, name, when: "14/10/2026 12:00", device: "<unknown>", ip: "192.0.2.1", method: "password", locale });
    const invoicePdf = Buffer.from("pdf fixture");
    await sendInvoiceEmail({ to, number: "INV-1", amountRub: 1490, dueAt: new Date("2026-12-31T00:00:00Z"), pdf: invoicePdf, purpose: "subscription", locale });
    const closingPdf = Buffer.from("closing fixture");
    await sendPaymentReceiptEmail({ to, amountRub: 1490, description: "Standard plan", actionUrl: 'https://wesetup.ru/finish?x="&y=1', isNewClient: false, subscriptionEnd: new Date("2026-12-31T00:00:00Z"), pointsSpent: 100, closingDocument: { number: "UPD-1", pdf: closingPdf }, locale });
    await sendFeedbackAdminEmail({ to, type: "bug", message: "<script>customer</script>", userName: name, userEmail: to, locale });
    await sendFeedbackReplyEmail({ to, replyMessage: "<script>reply</script>", originalMessage: "original", respondedByName: "Support", locale });
    await sendPlatformAdminTestEmail({ to, triggeredBy: name, locale });
    await sendDeviationAlertEmail({ to, journalName: "Temp journal", journalCode: "temp_control", deviationType: "Low temperature", details: "<script>details</script>", filledBy: name, locale });
    await sendComplianceReminderEmail({ to, missingJournals: ["<script>journal</script>"], organizationName, locale });
    await sendTemperatureAlertEmail({ to, equipmentName: "Fridge", temperature: 8, tempMin: 2, tempMax: 6, areaName: "Kitchen", filledBy: name, locale });
    const batch = sent.slice(start);
    assert.equal(batch.length, 16);
    assert.equal(batch[0].subject, m.email.verification.subject);
    assert.equal(batch[3].subject, m.email.accountPassword.subject);
    assert.equal(batch[5].subject, m.email.passwordReset.subject);
    assert.equal(batch[8].subject, m.email.invoice.subject.subscription.replace("{invoiceNumber}", "INV-1"));
    assert.equal(batch[9].subject, m.email.paymentReceipt.subject.renewal);
    assert.equal(batch[10].subject, m.email.feedbackAdmin.subject.replace("{feedbackType}", m.email.feedbackAdmin.type.bug).replace("{sender}", name));
    assert.equal(batch[11].subject, m.email.feedbackReply.subject);
    assert.equal(batch[12].subject, m.email.adminTest.subject);
    assert.equal(batch[13].subject, m.email.alerts.deviation.subject.replace("{deviationType}", "Low temperature").replace("{journalName}", "Temp journal"));
    assert.equal(batch[14].subject, m.email.alerts.compliance.subject.replace("{organizationName}", organizationName));
    assert.equal(batch[15].subject, m.email.alerts.temperature.subject.replace("{equipmentName}", "Fridge"));
    assert.deepEqual(batch[8].attachments?.map(({ filename, contentType }) => ({ filename, contentType })), [
      { filename: "Invoice-INV-1.pdf", contentType: "application/pdf" },
    ]);
    assert.ok(batch[8].html.includes(m.email.invoice.attachment.subscription));
    assert.ok(batch[8].html.includes(m.email.invoice.amountLabel));
    assert.match(batch[8].html, /1\s*490\s*₽/u);
    assert.ok(batch[9].html.includes(m.email.paymentReceipt.thankYou));
    assert.ok(batch[9].html.includes(m.email.paymentReceipt.closingDocumentDisclosure.replace("{documentNumber}", "UPD-1")));
    assert.match(batch[9].html, /1\s*490\s*₽/u);
    assert.ok(batch[9].html.includes('href="https://wesetup.ru/finish?x=&quot;&amp;y=1"'));
    assert.ok(batch[10].html.includes(m.email.feedbackAdmin.senderLabel));
    assert.ok(batch[10].html.includes("&lt;script&gt;customer&lt;/script&gt;"));
    assert.ok(batch[11].html.includes(m.email.feedbackReply.originalMessageLabel));
    assert.ok(batch[11].html.includes("&lt;script&gt;reply&lt;/script&gt;"));
    assert.ok(batch[12].html.includes(m.email.adminTest.body));
    assert.ok(batch[13].html.includes(m.email.alerts.deviation.title));
    assert.ok(batch[14].html.includes(m.email.alerts.compliance.intro));
    assert.ok(batch[15].html.includes(m.email.alerts.temperature.description));
    for (const message of batch) {
      assert.equal(message.to, to);
      assert.ok(message.html.includes(`lang="${locale === "uz" ? "uz-Latn" : locale}"`));
      assert.ok(!message.html.includes(name), "HTML from customer name must not execute");
      assert.ok(!message.html.includes(password), "password must be HTML escaped");
      assert.ok(!message.html.includes("<img src=x>"), "organization in the heading must be escaped too");
      assert.ok(!message.html.includes("{employeeCount"), "ICU placeholder must be resolved");
      assert.ok(!message.html.includes("<script>"), "customer values must be HTML escaped");
    }
    assert.ok(batch[1].html.includes("O‘tkir &amp; Partners"));
    assert.ok(batch[1].html.includes("?one=1&amp;two=2"));
    assert.ok(batch[2].html.includes("&lt;test&gt;&amp;password"));
    assert.ok(batch[7].html.includes("&lt;unknown&gt;"));
  }
  await sendInviteTokenEmail({ to, name, organizationName, inviteUrl: "https://wesetup.ru/invite/test", locale: "en", subject: "Custom <script>bad()</script>" });
  assert.equal(sent.at(-1)?.subject, "Custom <script>bad()</script>");
  assert.ok(!sent.at(-1)?.html.includes("<script>"));
});
