import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function photoDriveConfig()'),source.indexOf('// ─── File upload for videos'));
test('photo upload uses isolated credentials and folder; rejects permission failures',async()=>{
 const calls=[];const env={GOOGLE_CLIENT_ID:'video',GOOGLE_CLIENT_SECRET:'video-secret',GOOGLE_REFRESH_TOKEN:'video-refresh',GOOGLE_DRIVE_FOLDER_ID:'video-folder',PHOTOS_DRIVE_CLIENT_ID:'photo',PHOTOS_DRIVE_CLIENT_SECRET:'photo-secret',PHOTOS_DRIVE_REFRESH_TOKEN:'photo-refresh',PHOTOS_DRIVE_FOLDER_ID:'photo-folder'};
 const context=vm.createContext({process:{env},Buffer,URLSearchParams,fetch:async(url,options)=>{calls.push([url,options]);return {ok:calls.length!==3,json:async()=>calls.length===1?{access_token:'token'}:{id:'file'}};}});
 vm.runInContext(helper,context);
 await assert.rejects(context.uploadBufferToGoogleDrive(Buffer.from('photo'),'test.png','image/png'),/publicar/);
 assert.equal(calls[0][1].body.get('client_id'),'photo');
 assert.match(calls[1][1].body.toString(),/photo-folder/);
 assert.equal(env.GOOGLE_CLIENT_ID,'video');
 assert.equal(await context.storePhotoReference('https://example.invalid/photo.png'),'https://example.invalid/photo.png');
 await assert.rejects(context.storePhotoReference('data:image/svg+xml;base64,PHN2Zy8+'),/Formato/);
 env.PHOTOS_DRIVE_REFRESH_TOKEN='';assert.equal(context.isGoogleDriveConfigured(),false);
 await assert.rejects(context.storePhotoReference('data:image/png;base64,cGhvdG8='),/no disponible/);
});
