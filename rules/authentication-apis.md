# Authentication APIs

Base URL: `http://localhost:3000/api/auth`

## Overview
The authentication system handles user registration, login, and profile management with JWT-based authentication. Supports multiple user roles: `shop_owner`, `operator`, and `admin`.

## Endpoints

### 1. Register User
**POST** `/register`

Creates a new user account with specified role.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name",
  "role": "shop_owner" // or "operator", "admin"
}
```

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "role": "shop_owner"
  }
}
```

**Error Responses:**
- `400`: Missing required fields or user already exists
- `500`: Server error

---

### 2. Login
**POST** `/login`

Authenticates user and returns JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "role": "shop_owner"
  }
}
```

**Error Responses:**
- `401`: Invalid credentials or account deactivated
- `500`: Server error

---

### 3. Get Current User
**GET** `/me`

Returns current authenticated user information.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "role": "shop_owner"
  }
}
```

**Error Responses:**
- `401`: Invalid or missing token
- `500`: Server error

## Authentication Flow

1. **Registration**: User registers with email, password, name, and role
2. **Login**: User authenticates with email/password, receives JWT token
3. **Protected Routes**: Include JWT token in Authorization header for protected endpoints
4. **Token Format**: `Bearer <jwt_token>`

## User Roles

- **shop_owner**: Can manage shops, orders, and products
- **operator**: Can handle order confirmations and view assigned orders
- **admin**: Full system access including user management and analytics

## Security Features

- Password hashing with bcrypt
- JWT token expiration
- Account activation/deactivation
- Role-based access control