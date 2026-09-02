// import { LHData } from '$lib/server/LHData';
// import { SEOQData } from '$lib/server/SEOQData';
import { Keyword } from '$lib/server/Keyword';

const customerWebsites: string[] = [
    'https://radscafe.com.au/',
    'https://www.cjsgaragedoors.com.au/',
    //   // ... add more websites here
];
// LHData.extract(customerWebsites);
// SEOQData.extractData(customerWebsites);
Keyword.extract(customerWebsites);