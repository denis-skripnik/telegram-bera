const crypto = require('crypto')  
const { InlineKeyboard, InputFile } = require("grammy");
const languages = {};
languages['ru'] = require('./lng/ru.js');
languages['en'] = require('./lng/en.js');

// Function to determine user's language and load texts accordingly
const loadLanguageTexts = (language_code) => {
    const userLang = language_code === "ru" ? "ru" : "en";
    return languages[userLang];
};

const cryptoData = (data, type = 'encrypt') => {
    const secret = 'j$6aI*r%=f"H(t@5G#0g';
    const salt = 'Yoa:xlzCk5<np1woe3-4+M';
    if (type === 'decrypt') {
        const iv = Buffer.from(data.iv, 'hex'); // IV должно быть передано или извлечено
        const key = crypto.scryptSync(secret, salt, 32); // Генерация ключа
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        let decryptedData = decipher.update(data.content, 'hex', 'utf8');
        decryptedData += decipher.final('utf8'); // Добавление финального блока
        return decryptedData;
    } else {
        const iv = crypto.randomBytes(16); // Генерация вектора инициализации
        const key = crypto.scryptSync(secret, salt, 32); // Генерация ключа
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

        let encryptedData = cipher.update(data, 'utf8', 'hex');
        encryptedData += cipher.final('hex'); // Завершение шифрования

        // Возвращаем зашифрованные данные и IV, необходимый для расшифровки
        return {
            iv: iv.toString('hex'),
            content: encryptedData
        };
    }
};

// Функция для форматирования времени в HH:MM:SS
const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    // Форматируем значения в двузначные строки
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Функция для обрезки сообщения до 4096 символов
function truncateMessage(str, maxLength = 4096) {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

// Error handler
async function handleError(ctx, error, defaultMessage, wallet, lng, sendInitialETH) {
    console.error(error);

    const messageOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: lng.main_menu, callback_data: "/start" }]
            ]
        }
    };

    // Создаем отображение текстов ошибок и их кратких версий
    const errorMessages = {
        'The bera doesn\'t want to eat yet!': lng.error_bera_not_hungry,
        'execution reverted: Data already migrated': lng.error_data_already_migrated,
        'execution reverted: Insufficient energy to boost': lng.error_insufficient_energy_boost,
        'execution reverted: Elixir has reached its maximum value': lng.error_max_elixir,
        'execution reverted: Battery has reached its maximum value': lng.error_max_battery,
        'execution reverted: Insufficient energy to buy elixir': lng.error_insufficient_energy_buy_elixir,
        'execution reverted: Insufficient energy to boost time': lng.error_insufficient_energy_boost_time,
        'execution reverted: Failed to send Ether': lng.error_failed_to_send_ether,
        'execution reverted: Page number must be greater than 0': lng.error_page_greater_than_zero,
        'execution reverted: Task ID is out of range': lng.error_task_out_of_range,
        'execution reverted: Task already completed': lng.error_task_already_completed,
        'insufficient funds': lng.error_insufficient_funds,
        'cannot estimate gas': lng.error_cannot_estimate_gas,
        'Wallet not registered': lng.for_rewards_not_register,
        'Wallet already registered': lng.wallet_already_registered,
        'Invalid wallet address': lng.invalid_wallet_address,
        'No HONEE tokens approved for transfer': lng.no_approved_honey,
        'No eligible users': lng.no_eligible_users
    };

    let errorMessage = error.message || defaultMessage;

    // Ищем подходящее сообщение об ошибке
    for (const [key, value] of Object.entries(errorMessages)) {
        if (errorMessage.toLowerCase().includes(key.toLowerCase())) {
            errorMessage = value;

            // Дополнительно, если ошибка связана с недостатком средств, пополняем баланс
            if (key === 'insufficient funds') {
                await sendInitialETH(wallet);
                errorMessage += ` ${lng.balance_replenished}`;
            }
            break;
        }
    }

        // Обрезаем сообщение, если оно превышает 4096 символов
        errorMessage = truncateMessage(errorMessage, 4096);

try {
        await ctx.reply(`${errorMessage}`, messageOptions);
} catch(e) {}
}

// Функция для показа задач с постраничной навигацией
async function showTasksPage(ctx, page, pageSize, taskCount, contract, lng, address) {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, taskCount);

    const tasks = [];
    for (let i = start; i <= end; i++) {
        const task = await contract.getTask(i);
        const isTaskCompleted = await contract.completedTasks(address, i);
        if (isTaskCompleted && isTaskCompleted === true) continue;
        tasks.push({ id: i, title: task.title });
    }

    const keyboard = new InlineKeyboard();
    tasks.forEach(task => {
        keyboard.text(task.title, `task_${task.id}`).row();
    });

    if (page > 1) {
        keyboard.text(lng.previous, "prev_page").row();
    }
    if (page * pageSize < taskCount) {
        keyboard.text(next, "next_page").row();
}
    keyboard.text(lng.add_task, "add_task").row();
    keyboard.text(lng.main_menu, "/start").row();
    
    await ctx.reply(lng.here_are_tasks, { reply_markup: keyboard });
}

module.exports = {loadLanguageTexts, cryptoData, formatTime, handleError, showTasksPage};