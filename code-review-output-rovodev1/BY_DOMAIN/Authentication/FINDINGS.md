# Authentication Domain - Code Review

**[STATUS: review_done_needs_followup]**

---

## Key Findings

### 🟠 HIGH: No Token Expiry Handling
- Tokens can expire but no refresh strategy in UI
- User sees "Not authenticated" error instead of silent refresh
- Race condition possible if multiple requests expire simultaneously

### 🟠 HIGH: Password Reset Link Not Validated
- No expiry on reset links
- Old reset links still work forever
- No rate limiting on reset requests

### 🟡 MEDIUM: Anonymous Auth Always Used
- All users start anonymous
- Email/password upgrade path unclear
- Could allow multiple accounts per user

### 🟡 MEDIUM: No Session Timeout
- Sessions never expire
- Stolen tokens work indefinitely
- No way to force logout on all devices

## Tickets

- [ ] **TICKET-060**: Implement token refresh in auth layer (High)
- [ ] **TICKET-061**: Add reset link expiry and validation (High)
- [ ] **TICKET-062**: Implement session timeout (Medium)
- [ ] **TICKET-063**: Improve anonymous-to-registered flow (Medium)

---

**Effort**: 1-2 days | **Impact**: Security, user experience
