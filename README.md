# TapMyCar: Privacy-First Vehicle Contact Platform

Live: https://tapmycar.io | Google Play | iOS App Store

## Overview

TapMyCar is a complete end-to-end SaaS platform I designed and built from scratch. It enables privacy-preserving communication between vehicle owners and third parties through NFC/QR-based contact initiation and Twilio-mediated masked calling.

Status: Launched and live. Ready for real user data analysis and optimization.

## What I Built

### 1. Database Architecture (30+ Tables)

Designed complete normalized PostgreSQL schema optimized for both transactions and analytics:

Core tables: users, vehicles, calls, payments, subscriptions, orders
Analytics tables: analytics_events, call_logs, notifications_log, user_segments
Business tables: referrals, gift_codes, promo_codes, risk_tiers

Design decisions:
- Normalized structure for data integrity and consistency
- ACID compliance critical for payment processing
- Event-driven logging: every user action generates an event for analysis
- Strategic indexing on high-volume queries (created_at, user_id, subscription_tier)
- Foreign keys and check constraints for data quality

### 2. Analytics Infrastructure

Built complete event-logging system to capture user behavior:

Event schema: user_tapped_sticker, user_initiated_call, call_connected, user_subscribed, verification_completed, payment_processed

SQL queries I wrote calculate:
- DAU (Daily Active Users)
- Activation rate (% users who complete first call)
- Day-7, Day-30 retention by signup cohort
- Churn rate by segment
- Customer lifetime value

Ready to analyze: cohort retention patterns, first-call impact on retention, feature adoption

### 3. User Segmentation via K-Means Clustering

Implemented unsupervised learning to segment user base:

12 engineered features:
1. Verification score (email, phone, ID verification status)
2. Call completion count (successful calls initiated)
3. First-call latency (days from signup to first call)
4. Geographic concentration (Herfindahl index of target locations)
5. Device consistency (entropy of device types)
6. Signup source value (organic=3, referral=2, paid=1)
7. Engagement frequency (calls per active day)
8. Payment history score (on-time=1, late=0.5, failed=0)
9. Subscription tier trajectory (progression through tiers)
10. Churn risk indicators (support contacts, refund requests)
11. NPS proxy (gift codes sent, referrals completed)
12. Lifetime value proxy (total revenue / days as customer)

K-means with k=5 (elbow method) segments users into risk tiers.

Business use: Dynamic pricing, churn prediction, support prioritization

### 4. A/B Testing Framework

Designed experiments with proper statistical rigor:

- Power analysis: Calculate sample sizes (α=0.05, β=0.20)
- Hypothesis testing: T-tests and chi-square tests
- Effect size: Cramér's V, odds ratios
- Experiment design: Random assignment, stratified by signup_source
- Ready to test: SMS vs email verification, call notification timing, pricing tier positioning

### 5. Production Payment System

Integrated Stripe production API (live keys, real transactions):

Subscription tiers:
- Free: eTag only
- Standard: .99/month + .99/year
- Premium: .99/month + .99/year

Billing flow:
- Day 0:  activation charge
- Days 1-30: Trial period
- Day 30: Sticker ships + full month charge
- Day 60: Annual renewal begins

Implemented:
- Prorated calculations for mid-cycle upgrades
- Gift renewal logic (charge annual fee only)
- Tax calculation via Stripe Tax
- Webhook handling for charge events
- Refund logic with 14-day window

### 6. Twilio Integration

Built masked calling system:

Flow:
- User scans NFC sticker → captures vehicle_id
- API endpoint queries encrypted owner phone number
- Twilio routes: User phone → masked gateway → owner's real phone
- Call logged with caller_id, callee_id, timestamp, status, duration

Result: Real phone numbers never exposed. Complete audit trail captured.

### 7. Mobile Apps (iOS/Android)

Built with Capacitor (web-to-mobile):

iOS App Store: io.tapmycar.app
- Bundle ID: io.tapmycar.app
- Available: US, Canada, UK, Australia
- Age rating: 12+
- Compliance: Apple Guideline 3.1.1 (pricing on website, not in-app)

Android Google Play: Ready for production

Web: tapmycar.io (Vercel deployment)

### 8. Deployment Pipeline

Complete CI/CD infrastructure:

GitHub: Source of truth (private production repo)
Vercel: Serverless deployment
- API routes in /api/* (Node.js functions)
- Static assets in /public/* (CDN)
- Auto-deploy on every push
- Environment variables for secrets

Codemagic: iOS cloud builds
- Build certificate + provisioning profile
- Auto-publish to App Store Connect
- No Mac required

Google Play: Manual deployment (ready to automate)

## Technologies Used

Backend: Node.js, Express, Vercel Serverless
Database: PostgreSQL (Supabase)
Payments: Stripe (production)
Communications: Twilio, Firebase, Resend, Cloudflare
Frontend: React, Capacitor
DevOps: GitHub, Vercel, Codemagic
Analytics: SQL, Python (scikit-learn for K-means), Statistical testing (SciPy)

## What This Demonstrates

This is NOT a tutorial project. It shows:

1. System Architecture: Complete SaaS design from problem to production
2. Database Design: Normalized schema for analytics and transactions
3. Data Science: Cohort analysis SQL, K-means clustering, A/B test framework
4. Production Systems: Real payment processing, Twilio integration, mobile apps
5. Problem Solving: Platform compliance (Apple Guideline 3.1.1), tax calculation, refund edge cases
6. End-to-End Ownership: Product vision through deployment and live release

## Real User Data Analysis (Next Phase)

Once real users arrive, I will analyze:

Retention: Do early callers retain better? Day-7 cohort retention by signup source
Segmentation: Do K-means tiers predict churn? LTV variation across clusters
A/B Testing: SMS vs email verification impact on activation
Engagement: Feature adoption patterns, first-call timing distribution
Payments: Churn by tier, upgrade conversion, LTV by segment

## Repository Note

This is a sanitized portfolio version showing architecture and implementation. Production repository (private) contains live API keys and payment credentials.

Shows: Database design for analytics, event-driven logging, K-means feature engineering, A/B test design, production payment and communication systems, mobile app deployment.
