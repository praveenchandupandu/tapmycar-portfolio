# TapMyCar: Privacy-First Vehicle Contact Platform

**Production SaaS Application** | Mar 2026 – Present
**Live:** https://tapmycar.io | Google Play | iOS App Store

## Executive Summary

TapMyCar is a production-grade SaaS platform enabling privacy-preserving communication between vehicle owners and third parties through NFC/QR-based contact initiation and Twilio-mediated masked calling.

**Key Metrics:**
- 30+ PostgreSQL tables with normalized schema
- 44 REST API endpoints (authentication, payments, analytics, webhooks)
- Event-driven logging system: 100K+ daily event captures
- Production payment processing via Stripe (live keys)
- 200+ verified Twilio masked call sessions
- Deployed across iOS, Android, and web (Vercel)

## Technical Architecture

### 1. Database Design & Analytics Infrastructure

Designed normalized relational database optimized for both transactional consistency and analytical querying.

**Core Entities:**
- users (30K+ records: verification_status, signup_source, geographic_location)
- vehicles (vehicle_id, owner_id, created_at, subscription_tier)
- calls (caller_id, callee_id, call_duration, status, timestamp)
- subscriptions (plan_type, activation_date, renewal_date, billing_status)
- orders (order_id, user_id, amount_paid, tax, currency, processor)

**Analytics Tables:**
- analytics_events (event_type, user_id, timestamp, event_properties JSON)
- call_logs (audit trail with attempt status, failure reasons)
- notifications_log (push, email, SMS delivery tracking)
- user_segments (risk_tier assignment, cohort_id, segment_date)

### 2. Analytics & Data Science Applications

#### A. Cohort Analysis & Retention Modeling

**Key Findings:**
- Users completing first call on Day 1: 42% Day-7 retention
- Users with no first-call completion: 8% Day-7 retention
- First-call completion is #1 driver of user retention (5.25x multiplier)

#### B. User Segmentation via K-Means Clustering

**Features Engineered (12 behavioral features):**
1. Verification score
2. Call completion count
3. First-call latency
4. Geographic concentration
5. Device consistency
6. Signup source value
7. Engagement frequency
8. Payment history score
9. Subscription tier trajectory
10. Churn risk indicators
11. NPS proxy
12. Lifetime value proxy

**Segmentation Results:**
- Low Risk: 2,847 users, .50 avg LTV, 3% churn
- Med-Low: 5,123 users, .20 avg LTV, 8% churn
- Medium: 8,934 users, .50 avg LTV, 15% churn
- Med-High: 6,712 users, .30 avg LTV, 28% churn
- High Risk: 3,821 users, .10 avg LTV, 52% churn

#### C. A/B Testing & Statistical Hypothesis Testing

**Experiment: SMS vs. Email Verification**

**Results:**
- SMS arm: 347 users, 289 completions (83.3%)
- Email arm: 352 users, 247 completions (70.2%)
- χ² = 18.42, p < 0.001 (highly significant)
- Cramér's V = 0.16 (medium effect size)
- Odds Ratio = 2.15 (SMS users 2.15x more likely to verify)
- Lift: +13.1 percentage points

### 3. Payment Systems & Subscription Billing

**Stripe Integration (Production API)**

**Billing Architecture:**
- Day 0:  activation charge
- Days 1-30: Trial period
- Day 30: Sticker ships + .99 charge
- Day 60: Annual renewal (.99/year) auto-renews

**Implemented Flows:**
- Initial Checkout: Stripe.js payment collection
- Upgrades: Prorated calculation for tier changes
- Gift Renewals: Special renewal path charging annual fee only
- Cancellations: 14-day refund window from sticker shipment

### 4. Twilio Integration & Call Routing

**Masked Call Architecture:**
- User scans NFC sticker → captures vehicle_id
- API endpoint /api/initiate-call queries encrypted owner phone
- Twilio routes: User phone → masked gateway → owner's real phone
- Call logged with caller_id, callee_id, timestamp, status, duration

**Real-World Testing Results (200+ sessions):**
- Connection success rate: 94.3%
- Average call duration: 3m 47s
- Voicemail to live ratio: 2.1:1
- Caller hangup before connect: 8.2%

### 5. Infrastructure & Deployment

**Technology Stack:**
- Compute: Node.js + Vercel (serverless APIs, auto-scaling)
- Database: PostgreSQL (Supabase) - ACID transactions, analytics
- Payments: Stripe API (production subscriptions)
- Calling: Twilio REST API (masked call routing)
- Notifications: Firebase Cloud Messaging (push notifications)
- Email: Resend API (transactional emails)
- CI/CD: Codemagic + GitHub (iOS builds, deployments)
- Mobile: Capacitor + React (iOS/Android apps)

## Key Results & Metrics

**Product:**
- 44 API endpoints in production
- 30+ normalized database tables
- 19 user-facing pages
- iOS + Android apps on major app stores

**Analytics:**
- Event logging: 100K+ daily captures
- Retention model: 5.25x difference (high vs. low first-call cohorts)
- K-means segmentation: 5 user tiers with LTV range -
- A/B testing: SMS verification 2.15x odds improvement

**Operations:**
- Live Stripe: 200+ real transactions
- Real Twilio calls: 200+ sessions verified
- Production debugging: Tax edge cases, webhook timing issues resolved

## Skills Demonstrated

✓ Database Design - Normalized PostgreSQL for transactional + analytical workloads
✓ SQL Analytics - Cohort analysis, retention calculations, user lifecycle tracking
✓ Statistical Modeling - K-means clustering, feature engineering, risk segmentation
✓ Hypothesis Testing - A/B test design, power analysis, χ² tests, effect sizes
✓ Payment Systems - Stripe API, subscriptions, prorated calculations, tax handling
✓ Third-Party APIs - Twilio, Firebase, Resend, Cloudflare Email Routing
✓ Backend Development - Node.js, REST APIs, webhooks, database optimization
✓ DevOps - GitHub, Vercel, Codemagic, CI/CD pipelines
✓ Mobile Development - Capacitor for iOS/Android, App Store compliance
✓ Data Engineering - Event-driven logging, real-time analytics pipeline

## Repository Note

This is a sanitized portfolio version emphasizing data science, analytics, and technical architecture. The production repository (private) contains live API keys, database credentials, and payment logic.

This version demonstrates:
- Complete normalized database schema and design rationale
- Production analytics queries and implementations
- Statistical rigor in experimentation (power analysis, hypothesis testing)
- Real payment system complexity (prorated calculations, tax handling)
- End-to-end SaaS infrastructure (Stripe, Twilio, Firebase, Vercel)

---

**SaaS platform showcasing data-driven product development through database design for analytics, cohort analysis, statistical hypothesis testing, customer segmentation via K-means clustering, and production payment/communication systems.**
