# Harvest Link

A dependency-free Python full-stack crop bidding app. Farmers upload crops, set the first bid and auction duration, and verified consumers place live bids until the auction timer closes. The UI refreshes auction state every second. When time closes, the farmer gets the winning consumer's details and final amount for confirmation.

## Run

```bash
python3 server.py
```

Open `http://localhost:3000`.

You can also run:

```bash
npm start
```

## Features

- Separate farmer and consumer sections.
- Sign in / sign up flow with OTP verification.
- Farmers upload crops with image, quantity, starting bid, and bidding duration from 1 hour to 7 days.
- Consumers can search auctions and place live bids higher than the current bid until the auction closes.
- Auto-refresh pauses while a user is typing, so bid forms do not reset before submission.
- Bidding closes automatically after the farmer's selected time.
- Farmer sees the winning consumer's name, contact, location, and final bid amount.
- Data is stored locally in `data/db.json`, seeded from `data/seed.json` on first run.

## Demo Accounts

The app accepts any username and contact. Seeded verified users are available immediately:

- Farmer: `ravi`
- Farmer: `meena`
- Consumer: `greenbasket`
- Consumer: `freshcart`
