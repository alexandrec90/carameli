# Firewall Rules — SIP / RTP Port Restriction

These are host-level rules to be applied by ops. Do **not** bake them into Docker;
Docker's iptables chain runs before these rules if you use Docker-managed ports, so
apply these on the **host firewall** (or upstream cloud security group) directly.

---

## Telnyx IP Ranges

Telnyx publishes their current SIP and media IP ranges at:
<https://developers.telnyx.com/docs/voice/sip-trunking/ip-addresses>

As of 2026-03, the primary ranges are:

**SIP signalling:**

```text
185.148.0.0/22
216.81.32.0/20
```

**RTP media (may differ by region):**

```text
185.148.0.0/22
216.81.32.0/20
```

Always verify against the official Telnyx documentation before applying; ranges are
subject to change.

---

## iptables Rules

Save these to `/etc/iptables/rules.v4` (Debian/Ubuntu) or apply via your firewall
management tool. Reload with `iptables-restore < /etc/iptables/rules.v4`.

```bash
# -----------------------------------------------------------------------
# SIP — UDP 5060: allow only Telnyx IP ranges
# -----------------------------------------------------------------------
# Flush existing SIP rules first (if re-applying):
iptables -D INPUT -p udp --dport 5060 -j ACCEPT 2>/dev/null || true

iptables -A INPUT -p udp --dport 5060 -s 185.148.0.0/22  -j ACCEPT
iptables -A INPUT -p udp --dport 5060 -s 216.81.32.0/20  -j ACCEPT
iptables -A INPUT -p udp --dport 5060 -j DROP

# -----------------------------------------------------------------------
# SIP TLS — TCP 5061: allow only Telnyx IP ranges
# -----------------------------------------------------------------------
iptables -A INPUT -p tcp --dport 5061 -s 185.148.0.0/22  -j ACCEPT
iptables -A INPUT -p tcp --dport 5061 -s 216.81.32.0/20  -j ACCEPT
iptables -A INPUT -p tcp --dport 5061 -j DROP

# -----------------------------------------------------------------------
# RTP media — UDP 10000-20000: allow only Telnyx IP ranges
# -----------------------------------------------------------------------
iptables -A INPUT -p udp --dport 10000:20000 -s 185.148.0.0/22  -j ACCEPT
iptables -A INPUT -p udp --dport 10000:20000 -s 216.81.32.0/20  -j ACCEPT
iptables -A INPUT -p udp --dport 10000:20000 -j DROP
```

---

## ufw Rules (Ubuntu alternative)

```bash
# Allow Telnyx SIP (UDP 5060)
ufw allow from 185.148.0.0/22 to any port 5060 proto udp
ufw allow from 216.81.32.0/20 to any port 5060 proto udp

# Allow Telnyx SIP TLS (TCP 5061)
ufw allow from 185.148.0.0/22 to any port 5061 proto tcp
ufw allow from 216.81.32.0/20 to any port 5061 proto tcp

# Allow Telnyx RTP (UDP 10000-20000)
ufw allow from 185.148.0.0/22 to any port 10000:20000 proto udp
ufw allow from 216.81.32.0/20 to any port 10000:20000 proto udp

# Deny all other inbound on these ports
ufw deny 5060/udp
ufw deny 5061/tcp
ufw deny 10000:20000/udp
```

---

## Cloud Security Group (AWS / GCP / Azure)

If running on a cloud VM, apply equivalent security group / firewall rules at the
cloud level instead of (or in addition to) host iptables.

**Inbound rules to add:**

| Protocol | Port Range    | Source CIDRs                        | Description           |
|----------|---------------|-------------------------------------|-----------------------|
| UDP      | 5060          | 185.148.0.0/22, 216.81.32.0/20     | Telnyx SIP            |
| TCP      | 5061          | 185.148.0.0/22, 216.81.32.0/20     | Telnyx SIP TLS        |
| UDP      | 10000–20000   | 185.148.0.0/22, 216.81.32.0/20     | Telnyx RTP            |

Do **not** expose UDP 5060, TCP 5061, or UDP 10000–20000 to `0.0.0.0/0`.

---

## Verification

After applying rules, confirm from a Telnyx IP that traffic is accepted and from an
arbitrary IP that it is dropped:

```bash
# From a Telnyx IP (or approved IP) — should succeed:
nc -u -z <your-server-ip> 5060

# From any other IP — should time out / be dropped:
nc -u -z <your-server-ip> 5060
```

---

## Notes

- These rules do **not** restrict the FastAPI app port (8000) or the Jambonz REST API
  port (3000) — those should be behind nginx or a VPN, not publicly exposed.
- Re-verify Telnyx IP ranges after any Telnyx infrastructure change.
- Last verified: 2026-03-07
