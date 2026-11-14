import {signal} from '@preact/signals-core';
import type {ThreadHandle} from '../../../data/src/store';
import type {WindowScrollModel} from '../screens/WindowedScroll';

/** Exact scroll consumer port, including the actual readable handle; no partial-AppModel cast. */
export function scrollModel(handle:ThreadHandle):WindowScrollModel{
 return{t:signal((key:string)=>key),shells:signal(new Map()),handle:signal(handle),senderPageSelected:()=>{}};
}
