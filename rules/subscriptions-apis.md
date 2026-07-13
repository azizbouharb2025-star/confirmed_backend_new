# Subscriptions APIs

Base URL: `http://localhost:3000/api/subscriptions`

## Overview
Subscription management APIs handle billing plans, payment processing, and feature access control through Stripe integration.

## Authentication
Most endpoints require JWT authentication.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

## Endpoints

### 1. Get Subscription Plans
**GET** `/plans`

Retrieves available subscription plans and their features.

**Required Role:** None (public endpoint)

**Response (200):**
```json
[
  {
    "id": "free",
    "name": "Free",
    "price": 0,
    "currency": "USD",
    "interval": "monthly",
    "features": {
      "maxOperators": 1,
      "maxAICalls": 10,
      "maxShops": 1,
      "prioritySupport": false,
      "customIntegrations": false,
      "advancedAnalytics": false,
      "webhookSupport": true,
      "apiAccess": true
    },
    "description": "Perfect for small businesses getting started",
    "popular": false
  },
  {
    "id": "premium",
    "name": "Premium",
    "price": 49,
    "currency": "USD",
    "interval": "monthly",
    "features": {
      "maxOperators": 5,
      "maxAICalls": 500,
      "maxShops": 3,
      "prioritySupport": true,
      "customIntegrations": false,
      "advancedAnalytics": true,
      "webhookSupport": true,
      "apiAccess": true
    },
    "description": "Ideal for growing businesses",
    "popular": true
  },
  {
    "id": "enterprise",
    "name": "Enterprise",
    "price": 199,
    "currency": "USD",
    "interval": "monthly",
    "features": {
      "maxOperators": -1,
      "maxAICalls": -1,
      "maxShops": -1,
      "prioritySupport": true,
      "customIntegrations": true,
      "advancedAnalytics": true,
      "webhookSupport": true,
      "apiAccess": true,
      "dedicatedSupport": true,
      "slaGuarantee": true
    },
    "description": "For large enterprises with unlimited needs",
    "popular": false
  }
]
```

**Plan Features Explained:**
- **maxOperators**: Maximum number of operators (-1 = unlimited)
- **maxAICalls**: Monthly AI call limit (-1 = unlimited)
- **maxShops**: Maximum number of shops (-1 = unlimited)
- **prioritySupport**: Priority customer support
- **customIntegrations**: Custom platform integrations
- **advancedAnalytics**: Advanced reporting and analytics
- **webhookSupport**: Webhook functionality
- **apiAccess**: API access for integrations

**Error Responses:**
- `500`: Server error

---

### 2. Create Subscription
**POST** `/create`

Creates a new subscription with Stripe payment processing.

**Required Role:** Any authenticated user

**Request Body:**
```json
{
  "plan": "premium",
  "paymentMethodId": "pm_1234567890abcdef",
  "billingDetails": {
    "name": "John Doe",
    "email": "john@example.com",
    "address": {
      "line1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "postal_code": "10001",
      "country": "US"
    }
  }
}
```

**Response (200):**
```json
{
  "subscription": {
    "_id": "subscription_id",
    "plan": "premium",
    "status": "active",
    "stripeProductId": "prod_1234567890",
    "stripePriceId": "price_1234567890",
    "stripeCustomerId": "cus_1234567890",
    "stripeSubscriptionId": "sub_1234567890",
    "currentPeriodStart": "2024-01-01T00:00:00.000Z",
    "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
    "features": {
      "maxOperators": 5,
      "maxAICalls": 500,
      "maxShops": 3,
      "prioritySupport": true,
      "customIntegrations": false,
      "advancedAnalytics": true
    },
    "pricing": {
      "amount": 49.00,
      "currency": "USD",
      "interval": "monthly"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "clientSecret": "pi_1234567890_secret_abcdef",
  "paymentStatus": "succeeded"
}
```

**Payment Flow:**
1. Client creates payment method with Stripe.js
2. Client sends payment method ID to create subscription
3. Server creates Stripe customer and subscription
4. Server returns client secret for payment confirmation
5. Client confirms payment with Stripe.js
6. Subscription becomes active upon successful payment

**Error Responses:**
- `400`: Invalid plan or payment method
- `401`: Unauthorized
- `402`: Payment failed
- `500`: Server error

## Subscription Management

### Subscription Status
- **active**: Subscription is active and paid
- **past_due**: Payment failed, grace period active
- **canceled**: Subscription has been cancelled
- **unpaid**: Payment failed, access suspended
- **trialing**: In trial period (if applicable)

### Billing Cycles
- **Monthly**: Billed every month
- **Yearly**: Billed annually (future feature)
- **Usage-based**: Based on actual usage (future feature)

### Feature Limits
Features are enforced throughout the system:
- **Operator Limits**: Maximum concurrent operators
- **AI Call Limits**: Monthly AI-powered call limits
- **Shop Limits**: Maximum number of connected shops
- **Support Level**: Response time and priority
- **Integration Access**: Custom platform integrations

## Stripe Integration

### Payment Methods
- **Credit Cards**: Visa, MasterCard, American Express
- **Digital Wallets**: Apple Pay, Google Pay (future)
- **Bank Transfers**: ACH, SEPA (future)
- **Cryptocurrency**: Bitcoin, Ethereum (future)

### Security Features
- **PCI Compliance**: Stripe handles all payment data
- **3D Secure**: Additional authentication for cards
- **Fraud Detection**: Stripe Radar fraud protection
- **Encryption**: All payment data encrypted

### Webhook Handling
Stripe webhooks handle subscription events:
- **invoice.payment_succeeded**: Payment successful
- **invoice.payment_failed**: Payment failed
- **customer.subscription.updated**: Subscription changed
- **customer.subscription.deleted**: Subscription cancelled

## Usage Tracking

### Limits Enforcement
- **Real-time Checking**: Limits checked on each request
- **Soft Limits**: Warnings before hard limits
- **Grace Period**: Brief overage allowance
- **Automatic Blocking**: Access blocked when limits exceeded

### Usage Metrics
- **Operator Count**: Current active operators
- **AI Calls Made**: Monthly AI call usage
- **Shop Count**: Number of connected shops
- **API Requests**: Monthly API usage

### Overage Handling
- **Automatic Upgrade**: Suggest plan upgrades
- **Pay-per-use**: Additional usage charges (future)
- **Temporary Suspension**: Suspend features when over limit
- **Notification System**: Alert users of approaching limits

## Plan Comparison

### Free Plan
- **Target**: Small businesses, testing
- **Limitations**: 1 operator, 10 AI calls, 1 shop
- **Support**: Community support only
- **Best For**: Getting started, proof of concept

### Premium Plan
- **Target**: Growing businesses
- **Features**: 5 operators, 500 AI calls, 3 shops
- **Support**: Priority email support
- **Best For**: Established businesses with regular orders

### Enterprise Plan
- **Target**: Large organizations
- **Features**: Unlimited everything
- **Support**: Dedicated account manager
- **Best For**: High-volume businesses, custom needs

## Billing and Invoicing

### Invoice Generation
- **Automatic Billing**: Monthly billing cycles
- **Prorated Charges**: Partial month calculations
- **Tax Calculation**: Automatic tax calculation by region
- **Invoice History**: Complete billing history

### Payment Retry Logic
- **Smart Retries**: Intelligent retry scheduling
- **Dunning Management**: Automated payment recovery
- **Grace Period**: 7-day grace period for failed payments
- **Cancellation**: Automatic cancellation after multiple failures

### Refund Policy
- **Prorated Refunds**: Partial refunds for downgrades
- **Cancellation Refunds**: No refunds for cancellations
- **Dispute Handling**: Stripe dispute management
- **Credit System**: Account credits for service issues

## Integration with System Features

### Access Control
- **Feature Gates**: Check subscription before feature access
- **API Limits**: Rate limiting based on plan
- **UI Elements**: Show/hide features based on plan
- **Upgrade Prompts**: Suggest upgrades when limits reached

### Analytics Integration
- **Usage Tracking**: Monitor feature usage
- **Billing Analytics**: Revenue and churn metrics
- **Plan Performance**: Track plan popularity
- **Upgrade Patterns**: Analyze upgrade behavior