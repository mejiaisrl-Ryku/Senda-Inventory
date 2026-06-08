# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-08

Initial production state serving Kardy's and Trompas DC.

### Added
- Auth: JWT + refresh token, role-based access (ADMIN, STAFF)
- Products: create, resolve duplicates, link by ID, auto-create from order forms
- Orders: create pending orders via batch scan (accumulate multiple invoices, submit once); auto-receive on order acceptance
- Inventory counts: batch scanning — accumulate sheets, submit once
- Purveyors & departments: tracked per product and order
- Smart AI scan: Anthropic-powered invoice parsing
- Excel export for inventory and order reports
- Real-time updates via Socket.io
- Railway (backend + PostgreSQL) + Vercel (frontend) deployment

[Unreleased]: https://github.com/mejiaisrl-Ryku/senda-inventory/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mejiaisrl-Ryku/senda-inventory/releases/tag/v0.1.0
