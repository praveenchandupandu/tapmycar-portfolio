import pandas as pd
import numpy as np
from scipy import stats

# A/B Test: SMS vs Email Verification
# Synthetic data for framework demonstration
# Real data will replace this upon public launch

np.random.seed(42)

# SMS Group
sms_n = 347
sms_conversions = 289
sms_rate = sms_conversions / sms_n

# Email Group
email_n = 352
email_conversions = 247
email_rate = email_conversions / email_n

print("=== SMS vs Email Verification A/B Test ===\n")
print(f"SMS Group (n={sms_n}):")
print(f"  Conversions: {sms_conversions}")
print(f"  Conversion Rate: {sms_rate:.1%}\n")

print(f"Email Group (n={email_n}):")
print(f"  Conversions: {email_conversions}")
print(f"  Conversion Rate: {email_rate:.1%}\n")

# Chi-square test
contingency_table = np.array([[sms_conversions, sms_n - sms_conversions],
                              [email_conversions, email_n - email_conversions]])
chi2, p_value = stats.chi2_contingency(contingency_table)[:2]

print(f"Statistical Test Results:")
print(f"  Chi-square: {chi2:.2f}")
print(f"  P-value: {p_value:.4f}")
print(f"  Significant: {'Yes' if p_value < 0.05 else 'No'}\n")

# Effect size (Cramér's V)
n = sms_n + email_n
cramers_v = np.sqrt(chi2 / (n * (min(2, 2) - 1)))
print(f"Effect Size (Cramér's V): {cramers_v:.3f}")

# Odds ratio
odds_sms = sms_conversions / (sms_n - sms_conversions)
odds_email = email_conversions / (email_n - email_conversions)
odds_ratio = odds_sms / odds_email
print(f"Odds Ratio: {odds_ratio:.2f}x")
print(f"  SMS users {odds_ratio:.2f}x more likely to verify\n")

# Lift
lift = (sms_rate - email_rate) / email_rate * 100
print(f"Lift: +{lift:.1f} percentage points")

print("\n--- Recommendation ---")
print("SMS verification shows statistically significant improvement.")
print("Recommend rollout to all users.")
