// Load config
const config = require("./config.json");
const adminUserId = config.admin_id;
require("./databases/@db.js").initialize({
    url: config.db.server,
    poolSize: 15
  });
  const udb = require("./databases/usersdb");
const { Bot } = require("grammy");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { InlineKeyboard, InputFile } = require("grammy");

const helpers = require("./helpers.js");

// Telegram Bot token
const botToken = config.api_key;
const bot = new Bot(botToken);

// Ethers.js setup
const provider = new ethers.providers.JsonRpcProvider(config.rpc);
const contractAddress = config.contracts.telegramBera;
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "contracts/telegramBera.json")));
const rewardsAddress = config.contracts.rewardsContract;
const rewardsABI = JSON.parse(fs.readFileSync(path.join(__dirname, "contracts/rewardsContract.json")));
const honeyAddress = config.contracts.honeyContract;
const honeyABI = JSON.parse(fs.readFileSync(path.join(__dirname, "contracts/honeyContract.json")));

// Function to generate a new seed phrase
const generateSeedPhrase = () => {
    const wallet = ethers.Wallet.createRandom();
    return wallet.mnemonic.phrase;
};

// Function to get wallet from seed phrase
const getWalletFromSeed = (seedPhrase) => {
    return ethers.Wallet.fromMnemonic(seedPhrase).connect(provider);
};

// Send wallet address to admin
const sendWalletAddress = async (userId, walletAddress) => {
    const message = `User ID: <a href="tg://user?id=${userId}">${userId}</a>, Wallet Address: <code>${walletAddress}</code>`;
    const messageOptions = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "Main menu", callback_data: "/start" }]
            ]}
            };
   
    await bot.api.sendMessage(adminUserId, message, messageOptions);
};

// Send initial ETH to user
const sendInitialETH = async (userWallet) => {
try {
    const adminWallet = new ethers.Wallet(config.private_key, provider);
    const tx = await adminWallet.sendTransaction({
        to: userWallet.address,
        value: ethers.utils.parseEther("0.003")
    });
    await tx.wait();
} catch(e) {}
};



// Start command function
const startCommand = async (ctx) => {
    const userId = ctx.from.id;
    const lng = helpers.loadLanguageTexts(ctx.from.language_code);  // Загрузка текстов на основе языка пользователя
    let referrerId = ctx.match?.[1];
    if (!referrerId) referrerId = "0x6baB60b855205d3A27C3a46ce44Db3F144bdA132";

    let user = await udb.getUser(userId);
    let data = { id: userId, lng: ctx.from.language_code };

    if (!user) {
        const seedPhrase = generateSeedPhrase();
        data = { 
            id: userId, 
            lng: ctx.from.language_code, 
            seedPhrase: helpers.cryptoData(seedPhrase), 
            referer: referrerId 
        };
        const wallet = getWalletFromSeed(seedPhrase);
        await sendWalletAddress(userId, wallet.address);
        await sendInitialETH(wallet);
        user = data;
    }

    if (user && !user.referer && referrerId) {
        data.referer = referrerId;
    }

    const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
    const wallet = getWalletFromSeed(seedPhrase);
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // Получение данных пользователя из контракта
    const energy = await contract.beraEnergy(wallet.address);
    const lastFeedingTime = await contract.lastFeedingTime(wallet.address);
    const beraSettings = await contract.beraSettings(wallet.address);

    const battery = Number(beraSettings.battery);
    const elixir = Number(beraSettings.elixir);
    const currentTime = Math.floor(Date.now() / 1000);
    const feedingInterval = 3600 * battery; // Интервал кормления в секундах
    const timePassed = currentTime - lastFeedingTime;
    let accumulatedEnergy = 0;
    const baseEnergy = 50 * battery;
    const bonusEnergy = (baseEnergy * elixir) / 10;
    const totalEnergy = baseEnergy + bonusEnergy;
    
    if (timePassed >= feedingInterval) {
        accumulatedEnergy = totalEnergy;
    } else {
        accumulatedEnergy = (totalEnergy * timePassed) / feedingInterval;
    }
    
    // Добавление определения времени до следующего кормления
    const timeToNextFeeding = feedingInterval - timePassed;
    const nextFeedingIn = timeToNextFeeding > 0 ? timeToNextFeeding : 0;

    const formattedTimeToNextFeeding = helpers.formatTime(Math.max(timeToNextFeeding, 0));

    const keyboard = new InlineKeyboard()
        .text(lng.view_tasks, "tasks_list").row()
        .text(lng.feed, "feed")
        .text(lng.buy_battery, "confirm battery").row()
        .text(lng.buy_elixir, "confirm elixir")
        .text(lng.top_leaders, "leaders").row()
        .text(lng.for_rewards, "for_rewards")
        .text(lng.how_to_reward, "howToReward").row()

    try {
        await ctx.reply(
`${lng.your_bera_address}: <a href="https://bartio.beratrail.io/address/${wallet.address}">${wallet.address}</a>
${lng.referral_link}: https://t.me/test_farmBot?start=${wallet.address}
${lng.energy}: ${energy}

${lng.number_of_batteries}: ${battery}
${lng.elixir}: ${elixir}
${lng.time_until_next_feeding}: ${nextFeedingIn > 0 ? formattedTimeToNextFeeding : lng.feed_now}
${lng.accumulated_energy}: ${accumulatedEnergy.toFixed(2)}

${lng.getting_energy}

<a href="https://berachain.com">${lng.about_berachain}</a>, <a href="https://www.faucet.kodiak.finance">${lng.faucet}</a>, <a href="https://bartio.beratrail.io/">${lng.explorer}</a>.

${lng.about_bot}
`, { reply_markup: keyboard, parse_mode: "HTML" });
        if (Object.keys(data).length > 1) await udb.updateUser(data);
    } catch(error) {
        if (error.message.includes("blocked")) {
            await udb.removeUser(userId);
        } else {
            console.error(error);
        }
    }
};

// Farming check function
const checkFarming = async () => {
    let users = await udb.findAllUsers();
    for (let user of users) {
        const lng = helpers.loadLanguageTexts(user.lng);
        let data = {id: user.id};
        try {
            const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
            const wallet = getWalletFromSeed(seedPhrase);
            const contract = new ethers.Contract(contractAddress, abi, provider);
            const lastFeedingTime = await contract.lastFeedingTime(wallet.address);
            const beraSettings = await contract.beraSettings(wallet.address);

            const battery = beraSettings.battery;
            const currentTime = Math.floor(Date.now() / 1000);
            const minutes_boost = 3600 * battery;
            if (typeof user.isNotify !== 'undefined' && user.isNotify === true) continue;
            const timeToNextFeeding = lastFeedingTime.add(3600 * battery).sub(currentTime);

            if (timeToNextFeeding <= 0) {
                const keyboard = new InlineKeyboard().text(lng.main_menu, "/start").row();
                await bot.api.sendMessage(user.id, lng.feed_bear_prompt, { reply_markup: keyboard });
                data.isNotify = true;
            }
            if (Object.keys(data).length > 1) await udb.updateUser(data);
        } catch (error) {
            if (error.message.includes("blocked")) {
                await udb.removeUser(user.id);
            } else {
                console.error(error);
            }
        }
    }
};

const registerUserWallet = async (ctx, address, rewardsContract, lng, wallet, sendInitialETH) => {
    try {
        const gasEstimate = await rewardsContract.estimateGas.registerWallet(address);
        const transaction = await rewardsContract.registerWallet(address, { gasLimit: gasEstimate });
        await transaction.wait();
        const keyboard = new InlineKeyboard()
            .text(lng.check_stats, "check_stats")
            .text(lng.power_reyting, "power_reyting").row()
            .text(lng.main_menu, "/start");

        await ctx.reply(lng.wallet_registered, { reply_markup: keyboard });
    } catch (error) {
        await helpers.handleError(ctx, error, lng.error_registering_wallet, wallet, lng, sendInitialETH);
    }
};

// Command to send news
bot.command("news", async (ctx) => {
    // Только администратор может рассылать новости
    if (ctx.from.id !== adminUserId) return;

    // Извлекаем аргументы команды: язык и сообщение
    const args = ctx.message.text.split(' ').slice(1); // Получаем аргументы команды
    const language = args[0]; // Первый аргумент — язык (например, ru или en)
    const message = args.slice(1).join(' '); // Оставшиеся аргументы — это сообщение

    // Проверка на указанный язык
    const supportedLanguages = ['ru', 'en']; // Допустимые языки
    const defaultLanguage = 'en'; // Язык по умолчанию

    if (!supportedLanguages.includes(language)) {
        ctx.reply(`Неподдерживаемый язык. Пожалуйста, используйте один из: ${supportedLanguages.join(', ')}`);
        return;
    }

    let users = await udb.findAllUsers();

    for (let user of users) {
        // Проверяем язык пользователя
        const userLanguage = user.lng || defaultLanguage;

        // Если язык пользователя совпадает с указанным в команде или язык по умолчанию
        if (userLanguage === language || (userLanguage === defaultLanguage && language === 'en')) {
            try {
                const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
                const wallet = getWalletFromSeed(seedPhrase);
                await sendInitialETH(wallet);
                const lng = helpers.loadLanguageTexts(ctx.from.language_code);  // Load language texts based on the user’s language
                const keyboard = new InlineKeyboard().text(lng.main_menu, "/start").row();
                await bot.api.sendMessage(user.id, message, { reply_markup: keyboard });
            } catch (err) {
                console.error(`Не удалось отправить сообщение пользователю ${user.id}:`, err);
                continue; // Продолжаем к следующему пользователю, если возникла ошибка
            }
        }
    }

    ctx.reply(`Новость отправлена пользователям с языком: ${language}`);
});

// Command /reward.
bot.command("reward", async (ctx) => {
    const amount = ctx.message.text.split(' ')[1];
    if (!amount || amount && isNaN(amount)) return;
    const userId = ctx.from.id;
    const lng = helpers.loadLanguageTexts(ctx.from.language_code);  // Load language texts based on the user’s language
const user = await udb.getUser(userId)
if (!user) return;
const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
const wallet = getWalletFromSeed(seedPhrase);

const messageOptions = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: lng.main_menu, callback_data: "/start" }]
            ]}
            };
   
try {
        let minPower = ctx.message.text.split(' ')[2];
        if (!minPower || typeof minPower === 'undefined') minPower = 0;
        const honey = new ethers.Contract(honeyAddress, honeyABI, wallet);
        const rewardsContract = new ethers.Contract(rewardsAddress, rewardsABI, wallet);
    
        const gasEstimate = await honey.estimateGas.approve(rewardsAddress, ethers.utils.parseEther(amount));
        const transaction = await honey.approve(rewardsAddress, ethers.utils.parseEther(amount), {
            gasLimit: gasEstimate,
        });
        await transaction.wait();
        const gasEstimate2 = await rewardsContract.estimateGas.addReward(minPower);
        const transaction2 = await rewardsContract.addReward(minPower, {
            gasLimit: gasEstimate2,
        });
        await transaction2.wait();

        await ctx.reply(lng.rewards_sended, messageOptions);
    } catch (error) {
        await helpers.handleError(ctx, error, lng.add_rewards_error, wallet, lng, sendInitialETH);
    } finally {
        let data = {id: user.id, awaitingTaskDetails: false};
    await udb.updateUser(data);
    }

});

// Handle start command
bot.command("start", async (ctx) => {
    const messageText = ctx.message.text;
    const refMatch = messageText.match(/^\/start(?:\s|=)?(.*)?$/);

    if (refMatch && refMatch[1]) {
        ctx.match = refMatch;
        await startCommand(ctx);
    } else {
        await startCommand(ctx);
    }
});

const csvFilePath = path.join(__dirname, "top.csv");
const csvRewardsFilePath = path.join(__dirname, "rewardsTop.csv");

bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const lng = helpers.loadLanguageTexts(ctx.from.language_code);  // Load language texts based on the user’s language
const user = await udb.getUser(userId)
if (!user) return;
const messageOptions = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: lng.main_menu, callback_data: "/start" }]
            ]}
            };
    
    if (ctx.message.text.startsWith("/")) return;
    const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
    const wallet = getWalletFromSeed(seedPhrase);
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const rewardsContract = new ethers.Contract(rewardsAddress, rewardsABI, wallet);

    if (user.awaitingTaskDetails) {
        const taskDetails = ctx.message.text;
        const [title, description, action] = taskDetails.split(" | ");

        if (!title || !description || !action) {
            await ctx.reply(lng.invalid_add_task_format, messageOptions);
            return;
        }

        try {
            const balance = await wallet.getBalance();
            if (balance.lt(ethers.utils.parseEther("1"))) {
                await ctx.reply(lng.insufficient_balance_for_add_task, messageOptions);
                return;
            }

            const gasEstimate = await contract.estimateGas.addTask(title, description, action, {
                value: ethers.utils.parseEther("1"),
            });
            const transaction = await contract.addTask(title, description, action, {
                value: ethers.utils.parseEther("1"),
                gasLimit: gasEstimate,
            });
            await transaction.wait();

            await ctx.reply(lng.task_added, messageOptions);
        } catch (error) {
            await helpers.handleError(ctx, error, lng.error_adding_task, wallet, lng, sendInitialETH);
        } finally {
            let data = {id: user.id, awaitingTaskDetails: false};
        await udb.updateUser(data);
        }
        } else     if (ethers.utils.isAddress(ctx.message.text)) {
            await registerUserWallet(ctx, ctx.message.text, rewardsContract, lng, wallet, sendInitialETH);
        }
});

// Обработка всех callback_data в одном обработчике
const taskPages = {};
bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const lng = helpers.loadLanguageTexts(ctx.from.language_code);  // Load language texts based on the user’s language
    const user = await udb.getUser(userId);
    if (!user) return;
    const seedPhrase = helpers.cryptoData(user.seedPhrase, 'decrypt');
    const wallet = getWalletFromSeed(seedPhrase);
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const rewardsContract = new ethers.Contract(rewardsAddress, rewardsABI, wallet);
    let userData = {id: user.id, lng: ctx.from.language_code};

    let messageOptions = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: lng.main_menu, callback_data: "/start" }]
            ]}
            };

    try {
        // Обработка задач
        if (data === '/start') {
return         await startCommand(ctx);
        } else if (data === "leaders") {
    if (!seedPhrase) {
        return await ctx.reply(lng.please_start_bot, messageOptions);
    }

    try {
        let users = await udb.findAllUsers();
        const userAddresses = users.map(user => getWalletFromSeed(helpers.cryptoData(user.seedPhrase, 'decrypt')).address);
        let energies = [];

        // Parallel requests to contract
        const energyPromises = userAddresses.map(async (address) => {
            const energy = await contract.beraEnergy(address);
            return { address, energy };
        });

        const results = await Promise.all(energyPromises);

        for (let result of results) {
            if (!result.energy.isZero()) {
                energies.push(result);
            }
        }

        energies.sort((a, b) => b.energy.sub(a.energy)); // Sort by energy value

        const totalEnergy = energies.reduce((total, user) => total.add(user.energy), ethers.BigNumber.from(0));
        let rankMessage = `${lng.user_ranking}:
        ${lng.top_list_info}:
`;
        let csvData = "address,percent\n";

        energies.forEach((user, index) => {
            const percent = user.energy.mul(100).div(totalEnergy);
            rankMessage += `${index + 1}. <a href="https://bartio.beratrail.io/address/${user.address}">${user.address}</a> - ${user.energy.toString()} (${percent}%)\n`;
            csvData += `${user.address},${percent}\n`;
        });

        fs.writeFileSync(csvFilePath, csvData);

        // Send file
        await ctx.replyWithDocument(new InputFile(fs.createReadStream(csvFilePath), "top.csv"), { caption: lng.leaders_file });

        // Send the ranking
        await ctx.reply(rankMessage, messageOptions);
    } catch (error) {
        await helpers.handleError(ctx, error, lng.error_fetching_ranking, wallet, lng, sendInitialETH);
    }
} else if (data === "for_rewards") {
            // Получаем характеристики и вычисляем пример поинтов
            const userAddress = wallet.address;
            const registeredWallet = await rewardsContract.registeredWallets(userAddress);
if (registeredWallet === '0x0000000000000000000000000000000000000000') {
    messageOptions = {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: lng.registerWithgameWallet, callback_data: `regWallet ${userData.userWallet}`}],
                [{ text: lng.main_menu, callback_data: "/start" }]
            ]}
            };
    await ctx.reply(lng.for_rewards_not_register, messageOptions);
    return;
}
    
const settings = await contract.beraSettings(userAddress);
            const energy = await contract.beraEnergy(userAddress);
            const calculatedPower = energy.mul(settings.battery).add(energy.mul(settings.battery).mul(settings.elixir).div(100));            
            const nowPower = await rewardsContract.power(userAddress);
    
            // Отправляем информацию о наградах с примером
            const message = `
${lng.for_rewards_text}

${lng.for_rewards_example}:
Power = ${energy} * ${settings.battery} + (${energy} * ${settings.battery} * ${settings.elixir} / 100)
Power = ${calculatedPower.toString()}
${lng.now_power}: ${nowPower.toString()}`;
    
            const keyboard = new InlineKeyboard()
                .text(lng.check_stats, "check_stats")
                .text(lng.power_reyting, "power_reyting").row()
                .text(lng.main_menu, "/start");
    
            await ctx.reply(message, { reply_markup: keyboard });
    } else if (data === "check_stats") {
        try {
            const gasEstimate = await rewardsContract.estimateGas.checkPower();
            const transaction = await rewardsContract.checkPower({ gasLimit: gasEstimate });
            await transaction.wait();
            const keyboard = new InlineKeyboard()
            .text(lng.main_menu, "/start").row();

            await ctx.reply(lng.power_updated, { reply_markup: keyboard });
        } catch (error) {
            await helpers.handleError(ctx, error, lng.error_checking_power, wallet, lng, sendInitialETH);
        }

    } else if (data === "power_reyting") {
                    // Отправляем сообщение о начале сбора данных
                    let initialMessage = await ctx.reply(lng.gettingData);
        
                    try {
            let users = await udb.findAllUsers();
            const userAddresses = [];
        
            for (let user of users) {
    const userWallet = getWalletFromSeed(helpers.cryptoData(user.seedPhrase, 'decrypt')).address;
    // Проверяем, есть ли зарегистрированный кошелек для данного пользователя
    const registeredWallet = await rewardsContract.registeredWallets(userWallet);
    userAddresses.push({ registeredWallet, userWallet }); // Используем зарегистрированный кошелек, если он есть
            }
        
            let powerList = [];
        
            // Запрашиваем поинты для всех пользователей
            for (let userData of userAddresses) {
                try {
                    if (userData.registeredWallet === '0x0000000000000000000000000000000000000000') continue;
                    const userPower = await rewardsContract.power(userData.userWallet);
                    if (userPower && !userPower.isZero()) {
                        powerList.push({ address: userData.registeredWallet, power: userPower });
                    }
                } catch (e) {
                    console.error(`Ошибка при обработке пользователя ${userData.userWallet}:`, e);
                }
            }
        
            // Сортировка по поинтам
            powerList.sort((a, b) => b.power.sub(a.power));
        
            const totalPower = powerList.reduce((total, user) => total.add(user.power), ethers.BigNumber.from(0));
        
            let rankMessage = `${lng.rewards_ranking}:\n${lng.rewards_top_list_info}:\n`;
            let csvData = "address,percent\n";
        
            powerList.forEach((user, index) => {
                const percent = user.power.mul(100).div(totalPower);
                rankMessage += `${index + 1}. <a href="https://bartio.beratrail.io/address/${user.address}">${user.address}</a> - ${user.power.toString()} (${percent}%)\n`;
                csvData += `${user.address},${percent}\n`;
            });
        
            fs.writeFileSync(csvRewardsFilePath, csvData);
        
            // Отправляем файл с рейтингом
            await ctx.replyWithDocument(new InputFile(fs.createReadStream(csvRewardsFilePath), "power_ranking.csv"), { caption: lng.leaders_file });
        
            // Отправляем сообщение с рейтингом
            await ctx.reply(rankMessage, messageOptions);
        } catch (error) {
            await helpers.handleError(ctx, error, lng.error_fetching_ranking, wallet, lng, sendInitialETH);
        }
            // Удаляем сообщение о начале сбора данных в случае ошибки
            if (initialMessage && initialMessage.message_id) {
                await ctx.api.deleteMessage(initialMessage.chat.id, initialMessage.message_id);
            }
    }else if (data.indexOf('regWallet ').indexof > -1) {
        const address = data.split(' ')[1];
        if (!ethers.utils.isAddress(address)) return;
        await registerUserWallet(ctx, address, rewardsContract, lng, wallet, sendInitialETH);
    } else if (data === "tasks_list") {
            const taskCount = await contract.taskCount();
            const pageSize = 5;
            const page = 1;
            taskPages[userId] = { page, pageSize, taskCount };

            await helpers.showTasksPage(ctx, page, pageSize, taskCount, contract, lng, wallet.address);
        }
        // Пагинация задач
        else if (data === "next_page" || data === "prev_page") {
            const { page, pageSize, taskCount } = taskPages[userId];
            const newPage = data === "next_page" ? page + 1 : page - 1;
            taskPages[userId].page = newPage;
            await helpers.showTasksPage(ctx, newPage, pageSize, taskCount, contract, lng, wallet.address);
        }
        // Добавление новой задачи
        else if (data === "add_task") {
            await ctx.reply(lng.please_provide_details_for_add_task, messageOptions);
            userData.awaitingTaskDetails = true;
        }
        // Обработка конкретной задачи
        else if (data.startsWith("task_")) {
            const taskId = data.split("_")[1];
            const task = await contract.getTask(taskId);
            const keyboard = new InlineKeyboard().text(lng.i_did, `check_${taskId}`).row().text(lng.main_menu, "/start").row();
            
            await ctx.reply(`
<b>${task.title}</b>
${task.description}
${lng.action}: ${task.action}
            `, { parse_mode: "HTML", reply_markup: keyboard });
        }
        // Отметить выполнение задачи
        else if (data.startsWith("check_")) {
try {
    const taskId = data.split("_")[1];
    const gasEstimate = await contract.estimateGas.checkTask(taskId);
    const transaction = await contract.checkTask(taskId, { gasLimit: gasEstimate });
    await transaction.wait();
    await ctx.reply(lng.task_marked_complete, messageOptions);
} catch (error) {
    await helpers.handleError(ctx, error, `${lng.error_during} ${data}`, wallet, lng, sendInitialETH);
}
        }
        // Как наградить?
        else if (data === "howToReward") {
            await ctx.reply(lng.how_to_reward_text, messageOptions);
        }
        // Обработка действий с медведем
        else if (data === "feed") {
try {
    const gasEstimate = await contract.estimateGas.feed(wallet.address);
    const transaction = await contract.feed(wallet.address, { gasLimit: gasEstimate });
    await transaction.wait();
    await ctx.reply(lng.bear_fed, messageOptions);
    userData.isNotify = false;
} catch (error) {
    await helpers.handleError(ctx, error, lng.add_rewards_error, wallet, lng, sendInitialETH);
}
        }
        // Покупка бустов
        else if (data.indexOf("confirm ") > -1) {
            const data_type = data.split(' ')[1];
            if (typeof data_type === 'undefined') return;
    // Получаем значения с контракта для расчета затрат энергии
    const settings = await contract.beraSettings(wallet.address);

    let cost;

    if (data_type === "battery") {
        // Реальная стоимость для battery
        cost = 200 + Number(settings.battery) * 100;
    } else if (data_type === "elixir") {
        // Реальная стоимость для elixir
        cost = 200 + Number(settings.elixir) * 100;
    }

    // Подтверждение с указанием энергии
            const message = `${lng.confirm_action} ${lng[`buy_${data_type}`].toLowerCase()}?
${lng.energy_cost}: ${cost}`;
messageOptions = {
    parse_mode: "HTML",
    reply_markup: {
        inline_keyboard: [
            [{ text: lng.confirm_button, callback_data: data_type }],
            [{ text: lng.main_menu, callback_data: "/start" }]
        ]}
        };
            await ctx.reply(message, messageOptions);
        }
        else if (data === "battery" || data === "elixir") {
            const boostType = data === "battery" ? "battery" : "elixir";
            const boostText = data === "battery" ? lng.battery_purchased : lng.elixir_purchased;
            const gasEstimate = await contract.estimateGas.boost(boostType);
            const transaction = await contract.boost(boostType, { gasLimit: gasEstimate });
            await transaction.wait();
            await ctx.reply(boostText, messageOptions);
        }
    } catch (error) {
        await helpers.handleError(ctx, error, `${lng.error_during} ${data}`, wallet, lng, sendInitialETH);
    }
    if (Object.keys(userData).length > 2) await udb.updateUser(userData);
});

// Start the bot
bot.start();
setInterval(checkFarming, 600000);

console.log("Bot is running...");