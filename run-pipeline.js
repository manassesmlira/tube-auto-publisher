const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Função para executar comandos
function runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`🔧 Executando: ${command} ${args.join(' ')}`);
        
        const child = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            ...options
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, code });
            } else {
                resolve({ success: false, code });
            }
        });
        
        child.on('error', (error) => {
            reject(error);
        });
    });
}

// Função para ler dados do arquivo temp
function readTempData() {
    try {
        if (fs.existsSync('temp_video_data.json')) {
            const data = JSON.parse(fs.readFileSync('temp_video_data.json', 'utf8'));
            return data;
        }
    } catch (error) {
        console.log('⚠️ Erro ao ler dados temporários:', error.message);
    }
    return null;
}

// Função para executar pipeline com tratamento de erro
async function runPipeline(options = {}) {
    const {
        maxVideos = 1,
        sync = true,
        preview = false,
        quiet = false
    } = options;

    try {
        console.log('🚀 AUTO PUBLISHER - PIPELINE COMPLETO');
        console.log('════════════════════════════════════════════════════════════');
        console.log('⚙️ Configurações:');
        console.log(` 📊 Máximo de vídeos: ${maxVideos}`);
        console.log(` 🔄 Sincronizar Drive: ${sync ? 'Sim' : 'Não'}`);
        console.log(` 🎭 Modo preview: ${preview ? 'Sim' : 'Não'}`);
        console.log('════════════════════════════════════════════════════════════');

        // Passo 1: Sincronizar Google Drive (se habilitado)
        if (sync) {
            console.log('🚀 Sincronizando Google Drive → Notion');
            console.log('📝 Comando: node 5syncgdrive.js');
            console.log('──────────────────────────────────────────────────');
            
            const syncResult = await runCommand('node', ['5syncgdrive.js']);
            if (!syncResult.success) {
                console.log('❌ Erro na sincronização!');
                return { success: false, step: 'sync' };
            }
            console.log('✅ Sincronização concluída!');
        }

        // Passo 2: Buscar vídeos pendentes
        console.log('🚀 Buscando vídeos pendentes');
        console.log('📝 Comando: node 1fetchvideos.js');
        console.log('──────────────────────────────────────────────────');
        
        const fetchResult = await runCommand('node', ['1fetchvideos.js']);
        if (!fetchResult.success) {
            console.log('❌ Erro ao buscar vídeos!');
            return { success: false, step: 'fetch' };
        }
        console.log('✅ Busca de vídeos concluída!');

        // Ler dados do vídeo encontrado
        const videoData = readTempData();
        if (!videoData || !videoData.pageId) {
            console.log('❌ Nenhum vídeo encontrado para processar!');
            return { success: false, step: 'no_video' };
        }

        console.log(`📹 Vídeo selecionado: ${videoData.title}`);
        console.log(`📄 Page ID: ${videoData.pageId}`);

        // Passo 3: Download do vídeo (se não for preview)
        if (!preview) {
            console.log('🚀 Fazendo download do vídeo');
            console.log(`📝 Comando: node 2downloadvideo.js ${videoData.pageId}`);
            console.log('──────────────────────────────────────────────────');
            
            const downloadResult = await runCommand('node', ['2downloadvideo.js', videoData.pageId]);
            if (!downloadResult.success) {
                console.log('❌ Erro no download do vídeo!');
                return { success: false, step: 'download' };
            }
            console.log('✅ Download concluído!');

            // Passo 4: Upload para YouTube
            console.log('🚀 Fazendo upload para YouTube');
            console.log(`📝 Comando: node 3uploadyoutube.js ${videoData.pageId}`);
            console.log('──────────────────────────────────────────────────');
            
            const uploadResult = await runCommand('node', ['3uploadyoutube.js', videoData.pageId]);
            if (!uploadResult.success) {
                console.log('❌ Erro no upload para YouTube!');
                return { success: false, step: 'upload' };
            }
            console.log('✅ Upload para YouTube concluído!');

            // Passo 5: Atualizar Notion
            console.log('🚀 Atualizando status no Notion');
            console.log(`📝 Comando: node 4updatenotion.js ${videoData.pageId}`);
            console.log('──────────────────────────────────────────────────');
            
            const updateResult = await runCommand('node', ['4updatenotion.js', videoData.pageId]);
            if (!updateResult.success) {
                console.log('❌ Erro ao atualizar Notion!');
                return { success: false, step: 'update' };
            }
            console.log('✅ Notion atualizado!');
        } else {
            console.log('🎭 Modo preview ativo - Download e upload não executados');
        }

        console.log('════════════════════════════════════════════════════════════');
        console.log('🎉 PIPELINE COMPLETO!');
        console.log(`✅ Vídeo "${videoData.title}" processado com sucesso!`);
        console.log('════════════════════════════════════════════════════════════');
        
        // Limpar arquivo temporário
        if (fs.existsSync('temp_video_data.json')) {
            fs.unlinkSync('temp_video_data.json');
        }
        
        return { success: true };

    } catch (error) {
        console.log('💥 ERRO NO PIPELINE:', error.message);
        console.log('════════════════════════════════════════════════════════════');
        return { success: false, error: error.message };
    }
}

// Função principal
async function main() {
    const args = process.argv.slice(2);
    
    // Verificar se é pedido de ajuda
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🚀 AUTO PUBLISHER - PIPELINE COMPLETO
════════════════════════════════════════════════════════════
📖 USO:
  node run-pipeline.js [opções]

🔧 OPÇÕES:
  --preview     Modo preview (não faz download/upload real)
  --no-sync     Não sincronizar Drive
  --limit=N     Processar até N vídeos (padrão: 1)
  --quiet       Menos logs
  --help, -h    Mostrar esta ajuda

📋 EXEMPLOS:
  node run-pipeline.js              # Execução normal
  node run-pipeline.js --preview    # Modo preview
  node run-pipeline.js --limit=3    # Processar até 3 vídeos
  node run-pipeline.js --no-sync    # Sem sincronização Drive
        `);
        return;
    }

    // Parsear opções
    const options = {
        preview: args.includes('--preview'),
        sync: !args.includes('--no-sync'),
        quiet: args.includes('--quiet'),
        maxVideos: 1
    };

    // Parsear limite
    const limitArg = args.find(arg => arg.startsWith('--limit='));
    if (limitArg) {
        options.maxVideos = parseInt(limitArg.split('=')[1]) || 1;
    }

    // Executar pipeline
    const result = await runPipeline(options);
    process.exit(result.success ? 0 : 1);
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = { runPipeline };
