# telegram-bera
 Telegram bot with game for Berachain
![An image of the interface for my portfolio](https://denis-skripnik.name/uploads/ApplicationFrameHost_Z4O033Um5J.png)
## Feed, play with the bear and earn points!
You can connect a wallet and save points for it by participating in the reward rating.
Different tokens can be sent as rewards: HONEY by default.
The bot was created for the testnet, but it can also be adapted for the mainnet if desired.

# Install
0. Нужен node.js и Mongo DB.
1. Open config.json
Replace the rpc as needed.
Replace "BOT_API_KEY" with your bot's API key (get it from $[BotFather](https://t.me/BotFather)).
Admin ID 123456789 to your Telegram ID.
"WALLET_PKEY" to your wallet's private key. IMPORTANT: do not specify the key of your main wallet. Create a separate one for the bot and specify its private key.
Replace in the "contracts" section the addresses of smart contracts:
telegramBera and rewardsContract with your deployment (contract files in the "Contracts" folder).
honeyContract - the address of the HONEY token in the Berachain network of your choice.
Replace the server value in the "db" section if needed.
2. Install pm2:
``npm i pm2 --g``
3. Install npm packages:
``npm install``
4. Set permissions 0755 for the top.csv and rewardsTop.csv files. This is necessary so that the bot can update them.
5. Run the script:
``pm2 start testfarm.js -o logs/out.log -e logs/errors.log.``

## P.S.
1. Theoretically, you can change the essence of the game to a different one and run on a different network.
2. If you want to thank the users of the previous bot, you can use the rewardsTop.csv file. It contains a list of external (non-gaming) wallets and point percentages.