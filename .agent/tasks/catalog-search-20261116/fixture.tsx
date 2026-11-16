import React from 'react';
import { createRoot } from 'react-dom/client';
import { SearchableCatalog } from '../../../src/components/public/searchable-catalog';
createRoot(document.getElementById('root')!).render(<SearchableCatalog label="Поиск по бланкам" listClassName="items" groups={[
 {id:'daily', title:<h2>Ежедневные</h2>, items:[
  {id:'fridge',searchText:'fridge Учёт температуры СанПиН 4282-26',content:<a href="/api/journal-samples/fridge/pdf">Температура PDF</a>},
  {id:'health',searchText:'health Здоровье сотрудников',content:<a href="/journals-info/health">Здоровье</a>}
 ]},
 {id:'periodic',title:<h2>Периодические</h2>,items:[{id:'clean',searchText:'clean Генеральная уборка',content:<a href="/api/orders/clean/pdf">Уборка</a>}]}
]}/>);
