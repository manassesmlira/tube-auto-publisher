const { Client } = require('@notionhq/client');

// Inicializar cliente Notion
const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});

/**
 * Atualiza o status de um vídeo no Notion
 */
async function updateVideoStatus(pageId, status, youtubeData = null) {
    try {
        console.log(`📝 Atualizando status no Notion: ${status}`);
        
        const updateData = {
            properties: {
                'Upload Status': {  // ✅ CORRIGIDO: era 'Status'
                    select: {
                        name: status
                    }
                }
            }
        };

        // Se tem dados do YouTube, adiciona
        if (youtubeData) {
            // ✅ REMOVIDO: YouTube ID (não existe na base)
            
            if (youtubeData.videoUrl) {
                updateData.properties['YouTube URL'] = {  // ✅ CORRIGIDO: nome correto
                    url: youtubeData.videoUrl
                };
            }
            
            // ✅ ADICIONADO: Upload Date sempre que há dados do YouTube
            updateData.properties['Upload Date'] = {
                date: {
                    start: youtubeData.uploadDate || new Date().toISOString()
                }
            };
        }

        const response = await notion.pages.update({
            page_id: pageId,
            ...updateData
        });

        console.log('✅ Status atualizado no Notion');
        return response;

    } catch (error) {
        console.error('❌ Erro ao atualizar Notion:', error.message);
        throw error;
    }
}

/**
 * Adiciona log de erro no Notion
 */
async function addErrorLog(pageId, errorMessage) {
    try {
        console.log('📝 Adicionando log de erro no Notion...');
        
        await notion.pages.update({
            page_id: pageId,
            properties: {
                'Upload Status': {  // ✅ CORRIGIDO: era 'Status'
                    select: {
                        name: 'Error'
                    }
                },
                'Upload Date': {  // ✅ ADICIONADO: registra data do erro
                    date: {
                        start: new Date().toISOString()
                    }
                }
                // ✅ REMOVIDO: 'Error Log' e 'Last Attempt' (não existem na base)
            }
        });

        console.log('✅ Log de erro adicionado no Notion');

    } catch (error) {
        console.error('❌ Erro ao adicionar log no Notion:', error.message);
    }
}

/**
 * Marca vídeo como processando
 */
async function markAsProcessing(pageId) {
    return updateVideoStatus(pageId, 'Processing');
}

/**
 * Marca vídeo como enviado com sucesso
 */
async function markAsUploaded(pageId, uploadResult, videoData) {  // ✅ CORRIGIDO: assinatura da função
    const youtubeData = {
        videoUrl: uploadResult.videoUrl || uploadResult.url,
        uploadDate: new Date().toISOString()
    };
    
    return updateVideoStatus(pageId, 'Uploaded', youtubeData);
}

/**
 * Marca vídeo com erro
 */
async function markAsError(pageId, errorMessage) {
    await updateVideoStatus(pageId, 'Error');
    await addErrorLog(pageId, errorMessage);
}

module.exports = {
    updateVideoStatus,
    addErrorLog,
    markAsProcessing,
    markAsUploaded,
    markAsError
};
