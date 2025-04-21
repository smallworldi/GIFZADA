const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const fetch = require('node-fetch');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath); // Define o caminho do ffmpeg estático
const { execFile } = require('child_process');
const gifsicle = require('gifsicle');
require('dotenv').config();

// (restante do código continua normalmente)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const conversaoEscolha = new Map();

client.once('ready', () => {
  console.log(`Logado como ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.content === '!converter') {
    const embed = new EmbedBuilder()
      .setTitle('Conversor de Arquivos')
      .setDescription('Clique no botão abaixo para iniciar a conversão.')
      .setColor('DarkButNotBlack');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_conversor')
        .setLabel('Converter')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const { customId, user, channel } = interaction;

  if (customId === 'abrir_conversor') {
    const starterMessage = await channel.send({
      content: '‎', // caractere invisível (U+200E)
      allowedMentions: { users: [] }
    });

    const thread = await starterMessage.startThread({
      name: `Conversão-${user.username}`,
      autoArchiveDuration: 60,
      reason: 'Conversão de arquivos'
    });

    // Apaga a mensagem imediatamente
    starterMessage.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setTitle('Opções de Conversão')
      .setDescription(`${user}, escolha uma das opções abaixo e envie seu arquivo:`)
      .setColor('DarkAqua');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('video_to_gif').setLabel('🎥 Video → GIF').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resize_gif').setLabel('📏 Redimensionar GIF').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('crop_image').setLabel('✂️ Cortar Imagem').setStyle(ButtonStyle.Secondary)
    );

    await thread.send({ content: `${user}`, embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Thread criada com sucesso!', ephemeral: true });
  }

  const tipos = {
    video_to_gif: 'video-to-gif',
    resize_gif: 'resize-gif',
    crop_image: 'crop-image'
  };

  if (tipos[customId]) {
    conversaoEscolha.set(interaction.channel.id, tipos[customId]);
    await interaction.reply({
      content: `Conversão escolhida: **${tipos[customId]}**. Agora envie o arquivo aqui.`,
      ephemeral: false
    });
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.channel.isThread()) return;

  const tipo = conversaoEscolha.get(message.channel.id);
  const file = message.attachments.first();
  if (!tipo || !file) return;

  const aguardandoMsg = await message.channel.send({
    content: 'Aguarde... Estamos processando o seu arquivo.'
  });

  try {
    const { buffer, name, temporarios } = await processFile(file, tipo);
    const attachment = new AttachmentBuilder(buffer, { name });

    await aguardandoMsg.edit({ content: `Aqui está o arquivo convertido, ${message.author}.` });
    await message.channel.send({ files: [attachment] });

    // Apaga arquivos temporários após envio
    temporarios.forEach((f) => fs.existsSync(f) && fs.unlinkSync(f));
    conversaoEscolha.delete(message.channel.id);
  } catch (err) {
    console.error(err);
    await aguardandoMsg.edit({ content: 'Erro ao converter o arquivo. Tente novamente mais tarde.' });
  }
});

// Função principal de conversão
async function processFile(attachment, type) {
  const url = attachment.url;
  const nomeBase = Date.now();
  const temporarios = [];

  switch (type) {
    case 'video-to-gif': {
      const response = await fetch(url);
      const videoBuffer = await response.buffer();
      const tempInput = `temp_${nomeBase}.mp4`;
      const tempOutput = `temp_${nomeBase}.gif`;
      fs.writeFileSync(tempInput, videoBuffer);
      temporarios.push(tempInput, tempOutput);

      await new Promise((resolve, reject) => {
        ffmpeg(tempInput)
          .toFormat('gif')
          .outputOptions(['-vf', 'scale=320:-1,fps=7', '-t', '5', '-pix_fmt', 'rgb24'])
          .on('end', resolve)
          .on('error', reject)
          .save(tempOutput);
      });

      const gif = fs.readFileSync(tempOutput);
      return { buffer: gif, name: `convertido.gif`, temporarios };
    }

    case 'resize-gif': {
      const response = await fetch(url);
      const buffer = await response.buffer();
      const input = `in_${nomeBase}.gif`;
      const output = `out_${nomeBase}.gif`;
      fs.writeFileSync(input, buffer);
      temporarios.push(input, output);

      await new Promise((resolve, reject) => {
        execFile(gifsicle, ['--resize-width', '320', input, '-o', output], err => {
          if (err) return reject(err);
          resolve();
        });
      });

      const resized = fs.readFileSync(output);
      return { buffer: resized, name: `convertido.gif`, temporarios };
    }

    case 'crop-image': {
      const response = await fetch(attachment.url);
      const buffer = await response.buffer();

      const isGif = attachment.name.endsWith('.gif') || attachment.contentType === 'image/gif';

      if (isGif) {
        const inputPath = `input_${nomeBase}.gif`;
        const outputPath = `output_${nomeBase}.gif`;
        fs.writeFileSync(inputPath, buffer);
        temporarios.push(inputPath, outputPath);

        await new Promise((resolve, reject) => {
          execFile(gifsicle, ['--crop', '0,0+500x500', inputPath, '-o', outputPath], err => {
            if (err) return reject(err);
            resolve();
          });
        });

        const croppedGif = fs.readFileSync(outputPath);
        return { buffer: croppedGif, name: `convertido.gif`, temporarios };
      } else {
        const croppedImage = await sharp(buffer)
          .resize(500, 500, { fit: 'cover' })
          .toFormat('png')
          .toBuffer();
        return { buffer: croppedImage, name: `convertido.png`, temporarios: [] };
      }
    }

    default:
      throw new Error('Tipo de conversão inválido');
  }
}

client.login(process.env.TOKEN);