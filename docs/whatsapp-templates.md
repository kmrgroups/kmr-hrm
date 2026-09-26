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
