# TapMyCar: Privacy-First Vehicle Contact Platform

Self-Directed SaaS Learning Project | Mar 2026 – Present

## Overview

TapMyCar is a complete end-to-end SaaS platform I designed and built to demonstrate full-stack product development. The platform enables privacy-preserving communication between vehicle owners and third parties through NFC/QR-based contact initiation and Twilio-mediated masked calling.

Status: Functional prototype in development. Not yet public release.

## What I Built

### 1. Database Architecture (30+ Tables)

Designed complete normalized PostgreSQL schema:
- Core: users, vehicles, calls, payments, subscriptions, orders
- Analytics: analytics_events, call_logs, notifications_log, user_segments
- Features: referrals, gift_codes, promo_codes, risk_tiers

Design Decisions:
- Normalized structure for data integrity
- ACID compliance for payment processing
- Event-driven logging for analytics
- Strategic indexing for query performance

### 2. Analytics Infrastructure

Built event-logging system tracking user actions:
- Event schema: taps, scans, calls, verifications, payments
- SQL queries for cohort analysis and retention calculation
- User lifecycle tracking by signup cohort
- Performance metrics: DAU, activation rate, churn rate

### 3. User Segmentation via K-Means Clustering

Applied unsupervised learning to segment users:
- Engineered 12 behavioral features (verification, calls, engagement, payment history)
- K-means clustering with k=5 (determined via elbow method)
- Mapped clusters to risk tiers for dynamic pricing strategy
- Use case: customer support prioritization, churn prediction

### 4. A/B Testing Framework

Designed statistical experiments:
- Power analysis to calculate proper sample sizes
- Hypothesis testing (SMS vs. Email verification)
- T-tests for significance
- Effect size calculation
- Proper experiment design with control groups

### 5. Production Payment System

Integrated Stripe production API:
- Subscription management (free tier, Standard .99, Premium .99)
- Complex billing flows: activation charge → trial → recurring
- Prorated calculations for upgrades
- Webhook handling for payment events
- Tax calculation integration
- Refund logic with edge case handling

### 6. Twilio Integration

Built masked calling system:
- Users scan NFC sticker → initiates call
- Twilio routes call through masked number
- Real phone numbers never exposed to either party
- Call logging and metadata tracking
- Test calls verified through Twilio dashboard

### 7. Mobile Apps (iOS/Android)

Built with Capacitor:
- iOS app on App Store (Bundle ID: io.tapmycar.app)
- Android app on Google Play
- Navigated Apple Guideline 3.1.1 (pricing on website, not in-app)
- Regional availability management (US, Canada, UK, Australia)

### 8. Deployment Pipeline

Complete CI/CD setup:
- GitHub source control
- Vercel serverless deployment (auto-deploy on push)
- Codemagic for iOS cloud builds
- Environment variable management for secrets
- Automated testing and linting

## Technical Skills Demonstrated

Database Design: Normalized PostgreSQL, ACID compliance, indexing strategy
SQL & Analytics: Cohort analysis, retention queries, event logging
Statistical Analysis: A/B test design, hypothesis testing, power analysis
Machine Learning: K-means clustering, feature engineering, unsupervised learning
Backend: Node.js, REST APIs, webhook handling, database queries
Payments: Stripe API integration, subscription logic, tax handling
Communications: Twilio API, Firebase notifications, Resend email
Mobile Development: Capacitor, iOS/Android apps, App Store compliance
DevOps: GitHub, Vercel, Codemagic, CI/CD pipelines
Architecture: Full-stack SaaS design, scalability considerations

## Key Technologies

Backend: Node.js, Express, Vercel Serverless
Database: PostgreSQL (Supabase)
Payments: Stripe (production API)
Communications: Twilio, Firebase, Resend, Cloudflare
Frontend: React, Capacitor
DevOps: GitHub, Vercel, Codemagic
Analytics: SQL, Python (K-means), Statistical testing

## What This Project Demonstrates

This is NOT a tutorial project. It shows:

1. System Design Thinking - architected complete SaaS from user problem to production
2. Technical Depth - database design, APIs, analytics, payments, communications
3. Data Science Skills - cohort analysis, clustering, A/B testing with rigor
4. Production Experience - real API integrations, edge case handling, debugging
5. Problem Solving - navigated platform constraints, tax complexity, payment logic
6. End-to-End Ownership - from product vision through deployment

## Learning & Next Steps

This project taught me:
- Payment systems are complex (edge cases, tax, refunds)
- Analytics infrastructure requires careful design
- Product decisions should be data-driven
- Mobile platform compliance is non-trivial
- Real products require attention to details tutorials skip

Next: Public release with real user testing, refining retention metrics

## Repository Note

This is a sanitized portfolio version showing architecture, design decisions, and technical implementation. The production repository (private) contains live API credentials and payment processing logic.

Demonstrates: database design for analytics, cohort analysis, statistical testing, customer segmentation, production SaaS infrastructure.
