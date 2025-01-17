"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const topgg_autoposter_1 = require("topgg-autoposter");
const events_1 = require("events");
const Base_1 = require("./utilities/Base");
const DisplayChannelTable_1 = require("./utilities/tables/DisplayChannelTable");
const QueueChannelTable_1 = require("./utilities/tables/QueueChannelTable");
const QueueGuildTable_1 = require("./utilities/tables/QueueGuildTable");
const QueueMemberTable_1 = require("./utilities/tables/QueueMemberTable");
const util_1 = __importDefault(require("util"));
const BlackWhiteListTable_1 = require("./utilities/tables/BlackWhiteListTable");
const AdminPermissionTable_1 = require("./utilities/tables/AdminPermissionTable");
const ParsingUtils_1 = require("./utilities/ParsingUtils");
const PriorityTable_1 = require("./utilities/tables/PriorityTable");
const PatchingUtils_1 = require("./utilities/PatchingUtils");
const SlashCommands_1 = require("./utilities/SlashCommands");
const Commands_1 = require("./Commands");
const MessagingUtils_1 = require("./utilities/MessagingUtils");

const cron = require("node-cron");
const cronParser = require("cron-parser");

console.time("READY. Bot started in");
events_1.EventEmitter.defaultMaxListeners = 0;
let isReady = false;
const config = Base_1.Base.config;
const client = Base_1.Base.client;
const knex = Base_1.Base.knex;
client.login(config.token);
client.on("error", console.error);
client.on("shardError", console.error);
client.on("uncaughtException", (err, origin) => {
    console.error(`Caught exception:\n${util_1.default.inspect(err, { depth: null })}\nException origin:\n${util_1.default.inspect(origin, {
        depth: null,
    })}`);
});
if (config.topGgToken)
    (0, topgg_autoposter_1.AutoPoster)(config.topGgToken, client);
client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isButton()) {
            if (isReady && interaction.guild?.id && interaction.customId === "joinLeave") {
                await joinLeaveButton(interaction);
            }
        }
        else if (interaction.isCommand()) {
            if (!isReady) {
                await interaction.reply("Bot is starting up. Please try again in 5 seconds...");
            }
            else if (!interaction.guild?.id) {
                await interaction.reply("Commands can only be used in servers.");
            }
            else {
                const parsed = new ParsingUtils_1.ParsedCommand(interaction);
                await parsed.setup();
                const commands = [{ name: parsed.request.commandName, value: undefined }];
                let obj = parsed.request.options?.data;
                while (obj) {
                    commands.push({ name: obj?.[0]?.name, value: obj?.[0]?.value });
                    obj = obj?.[0]?.options;
                }
                await processCommand(parsed, commands);
            }
        }
    }
    catch (e) {
        console.error(e);
    }
});
client.on("messageCreate", async (message) => {
    try {
        const guildId = message.guild?.id;
        if (isReady && guildId && message.content[0] === "!") {
            const parsed = new ParsingUtils_1.ParsedMessage(message);
            await parsed.setup();
            if (parsed.queueGuild.enable_alt_prefix) {
                await processCommand(parsed, message.content
                    .substring(1)
                    .split(" ")
                    .map((str) => {
                    return { name: str, value: undefined };
                }));
            }
        }
    }
    catch (e) {
        console.error(e);
    }
});
client.once("ready", async () => {
    const guilds = Array.from(Base_1.Base.client.guilds.cache?.values());
    Base_1.Base.shuffle(guilds);
    await PatchingUtils_1.PatchingUtils.run(guilds);
    await QueueGuildTable_1.QueueGuildTable.initTable();
    await QueueChannelTable_1.QueueChannelTable.initTable();
    await DisplayChannelTable_1.DisplayChannelTable.initTable();
    await QueueMemberTable_1.QueueMemberTable.initTable();
    await BlackWhiteListTable_1.BlackWhiteListTable.initTable();
    await AdminPermissionTable_1.AdminPermissionTable.initTable();
    await PriorityTable_1.PriorityTable.initTable();
    SlashCommands_1.SlashCommands.register(guilds).then();
    MessagingUtils_1.MessagingUtils.startScheduler();
    console.timeEnd("READY. Bot started in");
    isReady = true;

    if (guilds.length > 0){
        for await (const guild of guilds){
            guild.msg_mode = 1;
            const queueChannels = await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(guild);
            for await (const queueChannel of queueChannels){
                if (queueChannel){
                    // Delete old messages (< 14 days)
                    await queueChannel.messages.fetch().then((messages) => {
                        const botMessages = messages.filter(msg => {return (msg.content.startsWith("A") && msg.author.bot)});
                        queueChannel.bulkDelete(botMessages)
                    });

                    const clearCronExp = "25 18 * * 2,4,6";


                    let now = new Date();
                    const timeToNextDate = Math.round((cronParser.parseExpression(clearCronExp,{tz: "UTC-3"}).next().toDate()- now)/60000);
                    const nextClearIn = (25 - now.getMinutes());
                    //if (nextClearIn >= 10){
                    //    let queueMessage = await queueChannel.send(`A fila será limpa em aproximadamente ${nextClearIn} minutos`);
                    //}
                    //else {
                    let queueMessage = await queueChannel.send(`A fila será limpa às 18h25`);
                    //}
                    cronSchedule("15 18 * * 2,4,6", 10, 1, "minuto", queueMessage, false);
                    cronSchedule("05 24 18 * * *", 55, 5, "segundo", queueMessage, true);
                    //cron.schedule("20 02 * * 3,5,0", async () => {queueMessage.delete()});
                }
            }
        }
    }
});

async function cronSchedule(cronExp, timeLeft, timeInterval, timeText, queueMessage, sendClearBool){
    cron.schedule(cronExp, async () => {
        const intervalMS = timeText.startsWith("m")?60000:1000;
        if (timeLeft > 0){
            await queueMessage.edit(`A fila será limpa em ${timeLeft} ${timeText + ((timeLeft>1)?"s":"")}`);
            timeLeft -= timeInterval;
        } else {
            return
        };
        
        let interval = await setInterval(async () => {
                if (timeLeft > 0){
                    await queueMessage.edit(`A fila será limpa em ${timeLeft} ${timeText + ((timeLeft>1)?"s":"")}`);
                    timeLeft -= timeInterval;
                } else {
                    if (sendClearBool){
                        queueMessage.edit(`A fila foi limpa`);
                        sendClear(queueMessage.channel);
                    }
                    clearInterval(interval);
                    return
                };
        }, timeInterval*intervalMS);
    }, {
        timezone: "America/Sao_Paulo"
    });
}

async function sendClear(queueChannel){
    await QueueMemberTable_1.QueueMemberTable.unstore(queueChannel.guild.id, queueChannel.id);
    MessagingUtils_1.MessagingUtils.internalUpdateDisplay({
        queueGuild: queueChannel.guild, queueChannel: queueChannel
    });
}

client.on("guildCreate", async (guild) => {
    if (!isReady)
        return;
    await QueueGuildTable_1.QueueGuildTable.store(guild).catch(() => null);
});
client.on("roleDelete", async (role) => {
    try {
        if (!isReady)
            return;
        if (await PriorityTable_1.PriorityTable.get(role.guild.id, role.id)) {
            await PriorityTable_1.PriorityTable.unstore(role.guild.id, role.id);
            const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(role.guild.id);
            const queueChannels = await QueueChannelTable_1.QueueChannelTable.fetchFromGuild(role.guild);
            for (const queueChannel of queueChannels) {
                MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, queueChannel);
            }
        }
    }
    catch (e) {
    }
});

async function memberUpdate(member) {
    try {
        if (!isReady)
            return;
        const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(member.guild.id);
        const queueMembers = await QueueMemberTable_1.QueueMemberTable.getFromMember(member.id);
        for await (const queueMember of queueMembers) {
            const queueChannel = (await member.guild.channels
                .fetch(queueMember.channel_id)
                .catch(() => null));
            MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, queueChannel);
        }
    }
    catch (e) {
    }
}
client.on("guildMemberRemove", async (guildMember) => {
    await memberUpdate(guildMember);
});
client.on("guildDelete", async (guild) => {
    if (!isReady)
        return;
    await QueueGuildTable_1.QueueGuildTable.unstore(guild.id).catch(() => null);
});
client.on("channelDelete", async (channel) => {
    try {
        if (!isReady || channel.type === "DM")
            return;
        const deletedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(channel.id);
        if (deletedQueueChannel) {
            await QueueChannelTable_1.QueueChannelTable.unstore(deletedQueueChannel.guild_id, deletedQueueChannel.queue_channel_id);
        }
        await DisplayChannelTable_1.DisplayChannelTable.getFromQueue(channel.id).delete();
    }
    catch (e) {
    }
});
client.on("channelUpdate", async (_oldCh, newCh) => {
    try {
        if (!isReady)
            return;
        const newChannel = newCh;
        const changedChannel = await QueueChannelTable_1.QueueChannelTable.get(newCh.id);
        if (changedChannel) {
            const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(changedChannel.guild_id);
            MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, newChannel);
        }
    }
    catch (e) {
    }
});
client.on("voiceStateUpdate", async (oldVoiceState, newVoiceState) => {
    await processVoice(oldVoiceState, newVoiceState);
});
async function checkPermission(parsed) {
    if (!parsed.hasPermission) {
        await parsed
            .reply({
            content: "ERROR: Missing permission to use that command",
            commandDisplay: "EPHEMERAL",
        })
            .catch(() => null);
        return false;
    }
    return true;
}
async function processCommand(parsed, command) {
    switch (command[0]?.name) {
        case "help":
            switch (command[1]?.value) {
                case undefined:
                    await Commands_1.Commands.help(parsed);
                    return;
                case "setup":
                    await Commands_1.Commands.helpSetup(parsed);
                    return;
                case "queues":
                    await Commands_1.Commands.helpQueue(parsed);
                    return;
                case "bot":
                    await Commands_1.Commands.helpBot(parsed);
                    return;
            }
            return;
        case "join":
            await Commands_1.Commands.join(parsed);
            return;
        case "leave":
            await Commands_1.Commands.leave(parsed);
            return;
        case "myqueues":
            await Commands_1.Commands.myqueues(parsed);
            return;
    }
    if (!(await checkPermission(parsed)))
        return;
    switch (command[0]?.name) {
        case "altprefix":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.altPrefixGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.altPrefixSet(parsed);
                    return;
            }
            return;
        case "autopull":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.autopullGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.autopullSet(parsed);
                    return;
            }
            return;
        case "blacklist":
            switch (command[1]?.name) {
                case "add":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.bwAdd(parsed, false, true);
                            return;
                        case "role":
                            await Commands_1.Commands.bwAdd(parsed, true, true);
                            return;
                    }
                    return;
                case "delete":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.bwDelete(parsed, false, true);
                            return;
                        case "role":
                            await Commands_1.Commands.bwDelete(parsed, true, true);
                            return;
                    }
                    return;
                case "list":
                    await Commands_1.Commands.bwList(parsed, true);
                    return;
                case "clear":
                    await Commands_1.Commands.bwClear(parsed, true);
                    return;
            }
            return;
        case "button":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.buttonGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.buttonSet(parsed);
                    return;
            }
            return;
        case "clear":
            await Commands_1.Commands.clear(parsed);
            return;
        case "color":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.colorGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.colorSet(parsed);
                    return;
            }
            return;
        case "display":
            await Commands_1.Commands.display(parsed);
            return;
        case "enqueue":
            switch (command[1]?.name) {
                case "user":
                    await Commands_1.Commands.enqueueUser(parsed);
                    return;
                case "role":
                    await Commands_1.Commands.enqueueRole(parsed);
                    return;
            }
            return;
        case "graceperiod":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.graceperiodGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.graceperiodSet(parsed);
                    return;
            }
            return;
        case "header":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.headerGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.headerSet(parsed);
                    return;
            }
            return;
        case "kick":
            await Commands_1.Commands.kick(parsed);
            return;
        case "kickall":
            await Commands_1.Commands.kickAll(parsed);
            return;
        case "lock":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.lockGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.lockSet(parsed);
                    return;
            }
            return;
        case "mentions":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.mentionsGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.mentionsSet(parsed);
                    return;
            }
            return;
        case "mode":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.modeGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.modeSet(parsed);
                    return;
            }
            return;
        case "next":
            await Commands_1.Commands.next(parsed);
            return;
        case "permission":
            switch (command[1]?.name) {
                case "add":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.permissionAddUser(parsed);
                            return;
                        case "role":
                            await Commands_1.Commands.permissionAddRole(parsed);
                            return;
                    }
                    return;
                case "delete":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.permissionDeleteUser(parsed);
                            return;
                        case "role":
                            await Commands_1.Commands.permissionDeleteRole(parsed);
                            return;
                    }
                    return;
                case "list":
                    await Commands_1.Commands.permissionList(parsed);
                    return;
                case "clear":
                    await Commands_1.Commands.permissionClear(parsed);
                    return;
            }
            return;
        case "priority":
            switch (command[1]?.name) {
                case "add":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.priorityAddUser(parsed);
                            return;
                        case "role":
                            await Commands_1.Commands.priorityAddRole(parsed);
                            return;
                    }
                    return;
                case "delete":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.priorityDeleteUser(parsed);
                            return;
                        case "role":
                            await Commands_1.Commands.priorityDeleteRole(parsed);
                            return;
                    }
                    return;
                case "list":
                    await Commands_1.Commands.priorityList(parsed);
                    return;
                case "clear":
                    await Commands_1.Commands.priorityClear(parsed);
                    return;
            }
            return;
        case "pullnum":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.pullnumGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.pullnumSet(parsed);
                    return;
            }
            return;
        case "queues":
            switch (command[1]?.name) {
                case "add":
                    await Commands_1.Commands.queuesAdd(parsed);
                    return;
                case "delete":
                    await Commands_1.Commands.queuesDelete(parsed);
                    return;
                case "list":
                    await Commands_1.Commands.queuesList(parsed);
                    return;
            }
            return;
        case "roles":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.rolesGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.rolesSet(parsed);
                    return;
            }
            return;
        case "shuffle":
            await Commands_1.Commands.shuffle(parsed);
            return;
        case "size":
            switch (command[1]?.name) {
                case "get":
                    await Commands_1.Commands.sizeGet(parsed);
                    return;
                case "set":
                    await Commands_1.Commands.sizeSet(parsed);
                    return;
            }
            return;
        case "start":
            await Commands_1.Commands.start(parsed);
            return;
        case "to-me":
            await Commands_1.Commands.toMe(parsed);
            return;
        case "whitelist":
            switch (command[1]?.name) {
                case "add":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.bwAdd(parsed, false, false);
                            return;
                        case "role":
                            await Commands_1.Commands.bwAdd(parsed, true, false);
                            return;
                    }
                    return;
                case "delete":
                    switch (command[2]?.name) {
                        case "user":
                            await Commands_1.Commands.bwDelete(parsed, false, false);
                            return;
                        case "role":
                            await Commands_1.Commands.bwDelete(parsed, true, false);
                            return;
                    }
                    return;
                case "list":
                    await Commands_1.Commands.bwList(parsed, false);
                    return;
                case "clear":
                    await Commands_1.Commands.bwClear(parsed, false);
                    return;
            }
            return;
    }
}
async function processVoice(oldVoiceState, newVoiceState) {
    try {
        if (!isReady)
            return;
        const oldVoiceChannel = oldVoiceState?.channel;
        const newVoiceChannel = newVoiceState?.channel;
        const member = newVoiceState.member || oldVoiceState.member;
        if (oldVoiceChannel === newVoiceChannel || !member)
            return;
        const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(member.guild.id);
        const storedOldQueueChannel = oldVoiceChannel
            ? await QueueChannelTable_1.QueueChannelTable.get(oldVoiceChannel.id)
            : undefined;
        const storedNewQueueChannel = newVoiceChannel
            ? await QueueChannelTable_1.QueueChannelTable.get(newVoiceChannel.id)
            : undefined;
        if (Base_1.Base.isMe(member) &&
            ((storedOldQueueChannel && storedNewQueueChannel) || !oldVoiceChannel || !newVoiceChannel)) {
            return;
        }
        if (storedNewQueueChannel && !Base_1.Base.isMe(member)) {
            try {
                if (storedNewQueueChannel.target_channel_id) {
                    const targetChannel = (await member.guild.channels
                        .fetch(storedNewQueueChannel.target_channel_id)
                        .catch(() => null));
                    if (targetChannel) {
                        if (storedNewQueueChannel.auto_fill &&
                            newVoiceChannel.members.filter((member) => !member.user.bot).size === 1 &&
                            (!targetChannel.userLimit ||
                                targetChannel.members.filter((member) => !member.user.bot).size <
                                    targetChannel.userLimit)) {
                            member.voice.setChannel(targetChannel).catch(() => null);
                            return;
                        }
                    }
                    else {
                        await QueueChannelTable_1.QueueChannelTable.setTarget(newVoiceChannel.id, knex.raw("DEFAULT"));
                    }
                }
                await QueueMemberTable_1.QueueMemberTable.store(newVoiceChannel, member);
                MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, newVoiceChannel);
            }
            catch (e) {
            }
        }
        if (storedOldQueueChannel) {
            try {
                if (Base_1.Base.isMe(member) && newVoiceChannel) {
                    await QueueChannelTable_1.QueueChannelTable.setTarget(oldVoiceChannel.id, newVoiceChannel.id);
                    member.voice.setChannel(oldVoiceChannel).catch(() => null);
                    await setTimeout(async () => await fillTargetChannel(storedOldQueueChannel, oldVoiceChannel, newVoiceChannel).catch(() => null), 1000);
                }
                else {
                    await QueueMemberTable_1.QueueMemberTable.unstore(member.guild.id, oldVoiceChannel.id, [member.id], storedOldQueueChannel.grace_period);
                    MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, oldVoiceChannel);
                }
            }
            catch (e) {
            }
        }
        if (!Base_1.Base.isMe(member) && oldVoiceChannel) {
            const storedQueueChannels = await QueueChannelTable_1.QueueChannelTable.getFromTarget(oldVoiceChannel.id);
            const storedQueueChannel = storedQueueChannels[~~(Math.random() * storedQueueChannels.length)];
            if (storedQueueChannel && storedQueueChannel.auto_fill) {
                const queueChannel = (await member.guild.channels
                    .fetch(storedQueueChannel.queue_channel_id)
                    .catch(() => null));
                if (queueChannel) {
                    await fillTargetChannel(storedQueueChannel, queueChannel, oldVoiceChannel);
                }
            }
        }
    }
    catch (e) {
        console.error(e);
    }
}
async function fillTargetChannel(storedSrcChannel, srcChannel, dstChannel) {
    const guild = srcChannel.guild;
    if (dstChannel.permissionsFor(guild.me).has("CONNECT")) {
        let storedMembers = await QueueMemberTable_1.QueueMemberTable.getNext(srcChannel);
        if (storedMembers.length > 0) {
            if (!storedSrcChannel.auto_fill) {
                storedMembers = storedMembers.slice(0, storedSrcChannel.pull_num);
            }
            if (dstChannel.userLimit) {
                const num = Math.max(0, dstChannel.userLimit - dstChannel.members.filter((member) => !member.user.bot).size);
                storedMembers = storedMembers.slice(0, num);
            }
            for await (const storedMember of storedMembers) {
                const queueMember = await QueueMemberTable_1.QueueMemberTable.getMemberFromQueueMember(srcChannel, storedMember);
                if (!queueMember)
                    continue;
                queueMember.voice.setChannel(dstChannel).catch(() => null);
            }
        }
    }
    else {
        const storedDisplayChannel = await DisplayChannelTable_1.DisplayChannelTable.getFirstFromQueue(srcChannel.id);
        if (storedDisplayChannel) {
            const displayChannel = (await guild.channels
                .fetch(storedDisplayChannel.display_channel_id)
                .catch(() => null));
            await displayChannel.send(`I need the **CONNECT** permission in the \`${dstChannel.name}\` voice channel to pull in queue members.`);
        }
        else {
            const owner = await guild.fetchOwner();
            owner
                .send(`I need the **CONNECT** permission in the \`${dstChannel.name}\` voice channel to pull in queue members.`)
                .catch(() => null);
        }
    }
}
async function joinLeaveButton(interaction) {
    try {
        const storedDisplayChannel = await DisplayChannelTable_1.DisplayChannelTable.getFromMessage(interaction.message.id);
        if (!storedDisplayChannel) {
            await interaction.reply("An error has occurred").catch(() => null);
            return;
        }
        let queueChannel = (await interaction.guild.channels
            .fetch(storedDisplayChannel.queue_channel_id)
            .catch(async (e) => {
            if (e.code === 50001) {
                await interaction
                    .reply({
                    content: `I can't see <#${storedDisplayChannel.queue_channel_id}>. Please give me the \`View Channel\` permission.`,
                })
                    .catch(() => null);
                return;
            }
            else {
                throw e;
            }
        }));
        if (!queueChannel)
            throw "Queue channel not found.";
        const member = await queueChannel.guild.members.fetch(interaction.user.id);
        const storedQueueMember = await QueueMemberTable_1.QueueMemberTable.get(queueChannel.id, member.id);
        if (storedQueueMember) {
            const storedQueueChannel = await QueueChannelTable_1.QueueChannelTable.get(queueChannel.id);
            await QueueMemberTable_1.QueueMemberTable.unstore(member.guild.id, queueChannel.id, [member.id], storedQueueChannel.grace_period);
            await interaction
                .reply({ content: `You left \`${queueChannel.name}\`.`, ephemeral: true })
                .catch(() => null);
        }
        else {
            await QueueMemberTable_1.QueueMemberTable.store(queueChannel, member);
            await interaction
                .reply({ content: `You joined \`${queueChannel.name}\`.`, ephemeral: true })
                .catch(() => null);
        }
        const queueGuild = await QueueGuildTable_1.QueueGuildTable.get(interaction.guild.id);
        MessagingUtils_1.MessagingUtils.updateDisplay(queueGuild, queueChannel);
    }
    catch (e) {
        if (e.author === "Queue Bot") {
            await interaction
                .reply({ content: "**ERROR**: " + e.message, ephemeral: true })
                .catch(() => null);
        }
        else {
            await interaction.reply("An error has occurred").catch(() => null);
            console.error(e);
        }
    }
}