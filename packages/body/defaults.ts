import type {SpeciesParams} from '../schema/index';
const silhouettes:Record<SpeciesParams['species'],Pick<SpeciesParams,'chestGirthMm'|'waistGirthMm'|'hipGirthMm'|'thighGirthMm'|'shinGirthMm'|'pawWidthMm'>>={
 canine:{chestGirthMm:1100,waistGirthMm:900,hipGirthMm:1200,thighGirthMm:850,shinGirthMm:470,pawWidthMm:170},
 feline:{chestGirthMm:1050,waistGirthMm:850,hipGirthMm:1150,thighGirthMm:800,shinGirthMm:440,pawWidthMm:160},
 rabbit:{chestGirthMm:1100,waistGirthMm:900,hipGirthMm:1220,thighGirthMm:900,shinGirthMm:450,pawWidthMm:170},
 bear:{chestGirthMm:1250,waistGirthMm:1050,hipGirthMm:1300,thighGirthMm:930,shinGirthMm:560,pawWidthMm:200},
 deer:{chestGirthMm:1050,waistGirthMm:850,hipGirthMm:1100,thighGirthMm:740,shinGirthMm:410,pawWidthMm:145},
 dragon:{chestGirthMm:1150,waistGirthMm:900,hipGirthMm:1250,thighGirthMm:900,shinGirthMm:500,pawWidthMm:180}
};
export const speciesDefaults=(species:SpeciesParams['species']):SpeciesParams=>({species,legType:species==='canine'||species==='feline'||species==='dragon'?'digitigrade':'plantigrade',heightMm:1800,neckGirthMm:500,...silhouettes[species],shoulderWidthMm:480,armLengthMm:600,legLengthMm:780,headWidthMm:species==='bear'?300:260,headLengthMm:280,snoutLengthMm:species==='feline'?45:species==='bear'?65:species==='rabbit'?40:130,snoutWidthMm:species==='feline'?120:species==='bear'?170:150,earHeightMm:species==='rabbit'?300:species==='bear'?65:160,earWidthMm:species==='rabbit'?85:100,earAngleRad:0,tailLengthMm:species==='bear'?100:species==='rabbit'?150:species==='deer'?250:900,tailBaseGirthMm:species==='rabbit'?300:200,tailTipGirthMm:species==='rabbit'?100:40,tailCurvature:species==='feline'?.5:.15,upperArmGirthMm:400,forearmGirthMm:310,pawLengthMm:180,footLengthMm:280,clawLengthMm:species==='deer'?0:25,paddingMm:0,layerMm:0});
