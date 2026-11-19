# Preserve the webmaster message draft

- AC1. The generated message and manual edits survive closing the composer, switching views, and reloading in the same browser. Drafts are isolated by administrator, slot, and donor.
- AC2. Failed or unconfirmed sends preserve the draft. A confirmed send removes its draft without removing a newer edit from another tab.
- AC3. The targeted regression verifies storage, isolation, and clearing. Type checking and the targeted gate pass.
