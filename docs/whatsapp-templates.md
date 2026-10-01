# WhatsApp message templates to submit to Meta

WhatsApp only lets a business start a conversation with a **pre-approved template**.
Create each one below in **Meta Business Manager → WhatsApp Manager → Message templates**:

- Category: **Utility**
- Language: **English** (code `en`)
- Name: exactly as shown (the app refers to it by name)
- Body: copy the text exactly; `{{1}}`, `{{2}}`… are filled in the order listed

Approval usually takes minutes to a few hours. Until a template is approved, set
`WHATSAPP_MODE=text` to test with numbers that have messaged your business number in the
last 24 hours.

---

### hrm_onboarding_invite
Variables: 1 = name, 2 = company, 3 = link, 4 = expiry date
```
Dear {{1}}, welcome to {{2}}! Please complete your joining details online (about 15 minutes, works on your phone). Keep Aadhaar, PAN, cancelled cheque and certificates ready.

Start here: {{3}}

This link is valid until {{4}}.
```

### hrm_onboarding_reminder
Variables: 1 = name, 2 = company, 3 = link, 4 = expiry date
```
Dear {{1}}, your joining details for {{2}} are still pending. Continue from where you left off: {{3}}

The link is valid until {{4}}.
```

### hrm_onboarding_submitted  (to HR)
Variables: 1 = employee name, 2 = designation, 3 = review link
```
{{1}} ({{2}}) has submitted the onboarding form. Review and approve here: {{3}}
```

### hrm_onboarding_sent_back
Variables: 1 = name, 2 = sections, 3 = HR comment, 4 = link
```
Dear {{1}}, HR needs a few corrections to your joining details.
Sections: {{2}}
Comment: {{3}}

Update here: {{4}}
```

### hrm_onboarding_approved
Variables: 1 = company, 2 = name, 3 = employee ID, 4 = portal link, 5 = username, 6 = temporary password
```
Welcome to {{1}}, {{2}}! Your employee ID is {{3}}.
Portal: {{4}}
Username: {{5}}
Temporary password: {{6}}
Please sign in and change your password.
```

### hrm_user_invited
Variables: 1 = name, 2 = company, 3 = role, 4 = portal link, 5 = username, 6 = temporary password
```
Dear {{1}}, your {{2}} HR portal account ({{3}}) is ready.
Portal: {{4}}
Username: {{5}}
Temporary password: {{6}}
```

### hrm_id_card_issued
Variables: 1 = name, 2 = company, 3 = employee ID, 4 = link
```
Dear {{1}}, your {{2}} ID card ({{3}}) is ready. View it here: {{4}}
```

If Meta rejects a template (for example because a variable is at the very start or end),
adjust the wording, keep the variable order, and update the template name under
**Settings → Message templates** in the app if you changed it.

## hrm_payslip_ready (Utility)

> Dear {{1}}, your payslip for {{2}} is ready. Net pay: {{3}}. See and download it here: {{4}}

Parameters: name, month, net pay, link to My payslips. (Payslips are emailed with the PDF attached; WhatsApp is optional.)

## Recruitment (Phase 4)

Candidates who have not messaged you first can only get WhatsApp messages from approved templates. Submit these three
in Meta Business Manager (category **Utility**). Until they are approved, the same messages go by e-mail only.

### hrm_interview_invite (Utility)

> Dear {{1}}, you are shortlisted for {{2}} at {{3}}. Interview: {{4}}, {{5}}. {{6}}. Please bring: {{7}}. Confirm or ask for another time here: {{8}}

Parameters: name, role, company, date and time, mode, venue or video link, documents to bring, confirm link.

### hrm_interview_reminder (Utility)

> Reminder: your interview for {{1}} at {{2}} is {{3}}, {{4}}. {{5}} Confirm or reschedule: {{6}}

Parameters: role, company, "today" / "tomorrow", date and time, venue or video link, confirm link.

### hrm_offer_letter (Utility)

> Congratulations {{1}}! {{2}} offers you {{3}} with an annual CTC of {{4}}, joining on {{5}}. Please accept or decline by {{6}}: {{7}}

Parameters: name, company, role, CTC, joining date, valid until, offer link. (The offer letter PDF is attached to the e-mail.)

The application acknowledgement, the regret message, the panel invitation and HR alerts go by e-mail only.

## QMS & training (Phase 5A)

Submit these two in Meta Business Manager (category **Utility**). Until they are approved, the same messages go by e-mail.

### hrm_training_invite (Utility)

> {{1}}: you are nominated for the training "{{2}}" on {{3}} at {{4}}. Please bring your ID card.

Parameters: company, training, date and time, venue.

### hrm_training_reminder (Utility)

> Reminder from {{1}}: training "{{2}}" tomorrow, {{3}}, at {{4}}. Please bring your ID card.

Parameters: company, training, time, venue.

"Training effectiveness to evaluate" (to supervisors) and "Roles & responsibilities to acknowledge" go by e-mail only.

## Engagement (Phase 5B)

Submit these two in Meta Business Manager (category **Utility**). Until they are approved, the same messages go by e-mail.

### hrm_announcement (Utility)

> {{1}} — {{2}}. Read it in your portal: {{3}}

Parameters: company, announcement title, portal link.

### hrm_survey_invite (Utility)

> {{1}}: please answer the survey "{{2}}" — a few minutes{{3}}. {{4}}

Parameters: company, survey title, ", open until 8 Oct" (or blank), survey link.

The survey reminder, "recognition received" and "your suggestion: decision" go by e-mail only.

## Policies & compliance (Phase 5C)

### hrm_policy_published (Utility)

> {{1}}: please read and acknowledge the policy "{{2}}" in your portal: {{3}}

Parameters: company, policy title, link. Until it is approved by Meta the message goes by e-mail. The compliance reminder to HR goes by e-mail only.
