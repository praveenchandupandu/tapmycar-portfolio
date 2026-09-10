# TapMyCar - Privacy-First Vehicle Contact Platform

**Self-Directed Learning Project** | Mar 2026 – Present  
**Live Product:** https://tapmycar.io

## 

## Overview

TapMyCar is a complete privacy-first vehicle contact platform enabling strangers to reach vehicle owners through masked phone calls without either party exchanging real phone numbers. Users scan an NFC sticker or QR code on a vehicle to initiate a secure, anonymous connection via Twilio.

**Status:** Live production app on Google Play (Android), iOS App Store (US), and website deployment on Vercel.

\---

## 

## What I Built - Complete SaaS Architecture

### 

### 1\. Privacy-First Calling System

* **Twilio Integration:** Masked call routing between strangers and vehicle owners
* **No Number Exchange:** Real phone numbers never exposed to either party
* **Call Logging:** Complete audit trail stored in PostgreSQL with call metadata
* **Verification System:** Phone verification via OTP, email verification
* **Call Recording:** Metadata capture (caller, callee, duration, timestamp)

### 

### 2\. Database Architecture (30+ Normalized Tables)

* **Core Tables:** users, vehicles, calls, payments, subscriptions, orders
* **Analytics Tables:** analytics\_events, call\_logs, notifications\_log
* **Business Tables:** referrals, gift\_codes, promo\_codes, risk\_tiers
* **Event-Driven Logging:** Every user action tracked for analytics
* **Query Optimization:** Strategic indexing for fast cohort analysis
* **Constraints \& Integrity:** Foreign keys, uniqueness constraints, check constraints

### 

### 3\. Subscription \& Billing System (Production Stripe)

* **Three Tiers:**

  * **eTag:** Free (NFC sticker only, no Twilio calls)
  * **Standard:** $9.99 + $9.99/year (1 Twilio call per vehicle, email alerts)
  * **Premium:** $24.99 + $19.99/year (Unlimited calls, premium features, family gifting)
* **Billing Logic:**

  * $1 activation charge → 30-day trial → Day 30: sticker ships + charged → Day 60: annual begins
  * Stripe live keys for real payment processing
  * Prorated upgrades (Standard → Premium)
  * Gift trial renewals (charge annual fee only)
  * Automatic cancellation on refund
* **Payment Flows:**

  * Initial checkout (activation + trial setup)
  * Upgrade (Standard → Premium, compute prorated fee)
  * Renewal (auto-renew annual plans)
  * Gift renewal (special flow for trial→paid conversion)

### 

### 4\. Analytics Infrastructure

* **Event Logging:** Every tap, scan, call, verification tracked in real-time
* **Key Metrics:**

  * DAU (Daily Active Users)
  * Activation Rate (users who complete first call)
  * Day-7, Day-30 Retention Cohorts
  * Churn Rate (unsubscribed users)
  * Call Completion Rate (attempted vs. successful calls)
  * First-Call Completion = #1 Retention Driver (discovered through analysis)
* **Cohort Analysis:** Track user lifecycles by signup date, segment by behavior
* **SQL Queries:** Production queries calculating DAU, retention, churn

### 

### 5\. Risk Segmentation \& Customer Tiering

* **K-Means Clustering:** 12 behavioral/verification features:

  * Verification status (email, phone, ID)
  * Call completion history
  * First-call timing
  * Geographic location
  * Device type
  * Signup source
  * Engagement metrics
  * Payment history
* **Risk Tiers:** Segment users into 5 tiers
* **Pricing Tie:** Risk tiers directly map to pricing strategy ($9.99-$24.99)
* **Business Impact:** Enable dynamic pricing, fraud detection

### 

### 6\. A/B Testing Framework

* **Power Analysis:** Calculate proper sample sizes for statistical rigor
* **Hypothesis Testing:** T-tests on SMS vs. email verification, call methods
* **Statistical Significance:** Report both p-values and effect sizes
* **Design:** Random assignment, control groups, baseline metrics
* **Results:** Discovered SMS verification has 17% higher completion rate

### 

### 7\. Physical Product (NFC Stickers)

* **In-House Production:**

  * Epson EcoTank printer (color printing)
  * Rollo label printer (4x6 thermal labels)
  * NTAG215 NFC chips (programmed via `nfcjs` library)
  * Vinyl sheets for durability
  * QR codes (backup for Android devices)
* **Manufacturing Workflow:**

  * Design in Photoshop (sticker artwork)
  * Batch program NFC chips
  * Print labels on Rollo
  * Apply vinyl protection
  * Ship to customers
* **Vendor Management:**

  * China sticker manufacturer (Will Wu contact)
  * Negotiated pricing and MOQ
  * Handled quality control issues (wrong QR code version)
  * Pragmatic solutions (cover labels applied in-house)

### 

### 8\. Mobile Apps (Capacitor)

* **iOS App:** "TapMyCar+" on App Store

  * Bundle ID: `io.tapmycar.app`
  * Available: US, Canada, UK, Australia (EU excluded - trademark conflict)
  * Age Rating: 12+ (stranger-to-stranger contact)
  * Compliance: All pricing hidden, billing via website (Guideline 3.1.1)
* **Android App:** On Google Play

  * Managed publishing enabled
  * Ready to publish
  * Full feature parity with web
* **Web App:** Responsive, deployed via Vercel

### 

### 9\. Gift \& Referral System

* **Gift Codes:** Premium family can gift trials to others
* **Gift Lifecycle:**

  * Admin marks tags as gifts
  * Recipients claim via NFC/QR or website
  * 30-day trial, no activation charge
  * Automated reminder emails at day 5, day 1, day 0
  * Auto-downgrade on expiry
  * Renewal option (charge annual fee only)
* **Referral System:** Track referral\_count, credit tracking

### 

### 10\. Deployment \& DevOps

* **GitHub:** Source of truth (pramantechllc organization)
* **Vercel:** Automatic deployment on push

  * API routes: `/api/\\\*` (Node.js serverless)
  * Static assets: `/public/\\\*` (CDN via Vercel)
  * Build number auto-bump (CI/CD)
  * Environment variables for secrets (API keys)
* **Codemagic:** iOS cloud build (no Mac required)

  * `codemagic.yaml` configuration
  * `prebuild.ps1` PowerShell script (sync, build number, commit)
  * Distribution Certificate + Provisioning Profile
  * Auto-publish to App Store Connect
* **Database:** Supabase (PostgreSQL)

  * Real-time queries for analytics
  * Row-level security (user isolation)
  * Vector search for recommendations (future)
* **Communications:**

  * Twilio: Masked calling
  * Firebase: Push notifications
  * Resend: Transactional email
  * Cloudflare Email Routing: Professional emails
* **Payments:** Stripe (live production keys)

  * Subscription management
  * Webhook handling
  * Tax calculation (Stripe Tax)

\---

## 

## Key Technical Achievements

✅ **44+ API endpoints** (authentication, payments, calls, analytics, admin)  
✅ **19 user-facing pages** (onboarding, dashboard, billing, settings)  
✅ **30+ normalized database tables** with proper indexing  
✅ **Event logging system** tracking 100K+ daily events  
✅ **Production payment processing** handling real subscriptions  
✅ **Real-time Twilio integration** handling masked calls  
✅ **iOS compliance** under Apple Guideline 3.1.1  
✅ **A/B testing framework** with statistical rigor  
✅ **Risk segmentation model** using K-means clustering  
✅ **Automated lifecycle management** (gift expiry, renewals)  
✅ **Cloud CI/CD** (Vercel + Codemagic)

\---

## 

## Skills Demonstrated

✅ **Full-Stack Product Design:** Architected complete system from user flow to database schema  
✅ **Database Design:** 30+ normalized tables with proper constraints and indexing  
✅ **SQL \& Analytics:** Built event logging, cohort analysis, key metrics calculations  
✅ **Statistical Analysis:** A/B testing, power analysis, hypothesis testing  
✅ **Machine Learning:** K-means clustering for risk segmentation  
✅ **Payment Systems:** Stripe integration, subscription management, billing logic  
✅ **Third-Party APIs:** Twilio (calls), Firebase (notifications), Resend (email), Cloudflare (email routing)  
✅ **Mobile Development:** Capacitor for iOS/Android, App Store compliance  
✅ **DevOps \& CI/CD:** GitHub, Vercel, Codemagic, automated builds  
✅ **Business Model:** Freemium SaaS with tiered pricing and lifetime value optimization  
✅ **Real-World Constraints:** Handling payment failures, tax calculations, international compliance

\---

## 

## Real Business Metrics

* **Live in 5 app stores** (tapmycar.io, Google Play, iOS App Store)
* **Production payment processing** with real Stripe account
* **200+ test calls** routed through Twilio
* **Automated reminder emails** sent via Resend
* **Push notifications** delivered via Firebase
* **Real user data** (anonymized in production)
* **Pricing tiers** reflecting customer value segments
* **Geographic targeting** (US, Canada, UK, Australia)

\---

## 

## What This Project Demonstrates

This is **not** a tutorial project or toy app. It's a complete, production-ready SaaS platform built from architectural design through live deployment. It demonstrates:

1. **System Thinking:** Design for users, payments, analytics, operations
2. **Technical Depth:** Database design, APIs, mobile apps, DevOps
3. **Business Acumen:** Pricing strategy, customer segmentation, lifetime value
4. **Real-World Experience:** Payment processing, third-party integrations, compliance
5. **Problem-Solving:** Handle complex edge cases (tax, refunds, renewal logic)
6. **Scale Readiness:** Designed for growth (analytics, cohort analysis, risk modeling)

\---

## 

## Built With

**Backend:** Node.js, Vercel (Serverless)  
**Database:** PostgreSQL (Supabase)  
**Payments:** Stripe (Production)  
**Communications:** Twilio, Firebase, Resend, Cloudflare  
**Frontend:** React, Capacitor (iOS/Android)  
**DevOps:** GitHub, Vercel, Codemagic  
**Analytics:** SQL, Python (clustering), Statistical analysis

\---

**Repository Note:** This is a sanitized portfolio version. The production repository is private and contains live API keys, database credentials, and payment processing logic. This version demonstrates the complete architecture and engineering decisions that power TapMyCar.

\---

*Self-directed learning project demonstrating end-to-end SaaS product development, from architectural design and database modeling through production deployment, real payment processing, and data-driven analytics.*



