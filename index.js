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
ffmpeg.setFfmpegPath(ffmpegPath); 
const { execFile } = require('child_process');
const gifsicle = require('gifsicle');
require('dotenv').config();


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
      .setTitle(':a_gifzada: **Bem-vindo ao nosso Conversor de Arquivos em fase BETA!**')
      .setDescription(`  
> :d_dot43: *Agora você pode transformar vídeos e imagens de maneira rápida, fácil e totalmente automática, sem sair do Gifzada. Confira abaixo como funciona e aproveite todas as opções disponíveis:*

:d_emoji_273: **Como utilizar o conversor:**  
\`1.\` Separe o arquivo que deseja converter antes de começar;  
\`2.\` Clique no botão abaixo para iniciar;  
\`3.\` Um espaço privado (thread) será criado exclusivamente para você;  
\`4.\` Dentro da thread, escolha a conversão desejada e envie seu arquivo;  
\`5.\` O resultado será entregue diretamente na mesma conversa, pronto para ser usado!

:d_emoji_274~1: **Opções de conversão disponíveis:**  

:d_arrow: **Vídeo para GIF**  
-# ・Transforme pequenos trechos de vídeos em GIFs animados de forma simples e rápida.  
-# ・Ideal para criar GIFs criativos a partir de formatos como .mp4, .wmv, .flv e .mov.  

:d_arrow: **Redimensionar GIF**  
-# ・Perfeito para reduzir o tamanho, otimizar o carregamento ou adaptar para redes sociais.  

:d_arrow: **Cortar Imagem em 1:1**  
-# ・Ótimo para remover áreas indesejadas ou destacar detalhes importantes.

:d_tag: **Informações adicionais:**  
・As conversões são automáticas, práticas e feitas dentro da thread privada;  
・Tudo acontece de forma simples, rápida e sem complicação aqui no **GIFZADA**!
`)
     .setThumbnail('https://cdn.discordapp.com/icons/953748240589787136/a_85b194eaf3055cfc583d70b3b14cbaa5.gif?size=2048')
      .setColor('#870cff');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('abrir_conversor')
        .setLabel('Converter')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const { customId, user, channel } = interaction;

  if (customId === 'abrir_conversor') {
    const starterMessage = await channel.send({
      content: '‎', 
      allowedMentions: { users: [] }
    });

    const thread = await starterMessage.startThread({
      name: `Conversão-${user.username}`,
      autoArchiveDuration: 60,
      reason: 'Conversão de arquivos'
    });

    
    starterMessage.delete().catch(() => {});
    const embed = new EmbedBuilder()
      .setTitle('Opções de Conversão')
      .setDescription(`${user}, 
      -> Escolha uma das opções abaixo de acordo com o que deseja.
-> Envie seu arquivo (imagem ou vídeo) no chat e aguarde o bot realizar a conversão.
-> Seu chat será fechado automaticamente.`)
      .setColor('#870CFF');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
.setCustomId('video_to_gif').setLabel('Video → GIF')
.setEmoji('<:videotogif:1366159226891931688>')
.setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
      .setCustomId('resize_gif').setLabel('Redimensionar GIF')
.setEmoji('<:resize:1366160012774477824>')
.setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
.setCustomId('crop_image').setLabel('Cortar Imagem')
.setEmoji('<:crop:1366160563872202892>')
.setStyle(ButtonStyle.Secondary)
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
      const validFormats = ['.mp4', '.wmv', '.flv', '.mov'];
      const fileExtension = attachment.name.toLowerCase().match(/\.[^.]*$/)?.[0];
      
      if (!fileExtension || !validFormats.includes(fileExtension)) {
        throw new Error('Formato de vídeo não suportado. Use: .mp4, .wmv, .flv ou .mov');
      }

      const response = await fetch(url);
      const videoBuffer = await response.buffer();
      const tempInput = `temp_${nomeBase}${fileExtension}`;
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

      const isGif = attachment.name.toLowerCase().endsWith('.gif') || attachment.contentType === 'image/gif';

      if (isGif) {
        const inputPath = `input_${nomeBase}.gif`;
        const outputPath = `output_${nomeBase}.gif`;
        fs.writeFileSync(inputPath, buffer);
        temporarios.push(inputPath, outputPath);

        await new Promise((resolve, reject) => {
          execFile(gifsicle, [
            '--resize', '500x500',
            inputPath, 
            '-o', outputPath
          ], err => {
            if (err) return reject(err);
            resolve();
          });
        });

        const croppedGif = fs.readFileSync(outputPath);
        return { buffer: croppedGif, name: `convertido.gif`, temporarios };
      } else {
        const extension = attachment.name.split('.').pop().toLowerCase();
        const croppedImage = await sharp(buffer)
          .resize(500, 500, {
            fit: 'cover',
            position: 'center'
          })
          .toBuffer();
        
        return { 
          buffer: croppedImage, 
          name: `convertido.${extension || 'png'}`, 
          temporarios: [] 
        };
      }
    }

    default:
      throw new Error('Tipo de conversão inválido');
  }
}

client.login(process.env.TOKEN);
