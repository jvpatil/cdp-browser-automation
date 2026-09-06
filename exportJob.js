(async()=>{
    const d=new Date(),dateTag=`${String(d.getDate()).padStart(2,"0")}${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${String(d.getFullYear()).slice(-2)}`,hostKey=location.hostname.split(".")[0].toUpperCase(),jobName=window.__cdpJobConfig?.name||`ExportJob_${dateTag}`,customTable=window.__cdpJobConfig?.customTable,payloadName=window.__cdpExportPayloadName||window.__cdpJobConfig?.payloadName||"Customer",customCode=String(window.__cdpJobConfig?.fileNameCode||"")||(customTable?(/profile/i.test(customTable.label)?"PROFILE":/behavior/i.test(customTable.label)?"BEH":/transaction/i.test(customTable.label)?"TXN":/product/i.test(customTable.label)?"PRODUCT":"OTH"):String(payloadName).replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toUpperCase()),purpose=String(window.__cdpJobConfig?.purpose||"").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toUpperCase(),fileName=window.__cdpJobConfig?.fileName||[customCode,hostKey,purpose].filter(Boolean).join("_"),C={
        description:"Independent export draft validation",destination:window.__cdpJobConfig?.destinationName||`OOS-DST-${dateTag}`,compression:window.__cdpJobConfig?.compression||"none",payloadType:window.__cdpJobConfig?.payloadType||"data-object",payloadName:window.__cdpExportPayloadName||"Customer",filterRecords:window.__cdpJobConfig?.filterRecords||window.__cdpJobConfig?.filter||"UPDATED",frequency:window.__cdpSchedule?.frequency||"Daily"
  },nextRun=(()=>{
        const x=new Date();
    x.setHours(x.getHours()+1,0,0,0);
    return x
  })(),nextHour24=nextRun.getHours(),nextHourButtonset=nextHour24<12?"recurring-hourly-am":"recurring-hourly-pm",nextHourValue=String(nextHour24),sleep=ms=>new Promise(r=>setTimeout(r,ms)),visible=e=>!!e&&e.getClientRects().length>0,textOf=e=>(e.textContent||"").replace(/\s+/g," ").trim(),normalize=s=>(s||"").replace(/\s+/g,"").trim().toLowerCase(),find=s=>[...document.querySelectorAll(s)].find(visible),wait=async(fn,label,timeout=3000)=>{
        timeout=Math.min(timeout,3000);
    const end=Date.now()+timeout;
    while(Date.now()<end){
            const value=typeof fn==="string"?find(fn):fn();
      if(value)return value;
      await sleep(150)
    }
        throw new Error("Not available after 3 seconds: "+label)
  },setValue=(el,value)=>{
        el.scrollIntoView({
            block:"center"
    });
    el.focus();
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
    setter?setter.call(el,value):el.value=value;
    ["input","change"].forEach(type=>el.dispatchEvent(new Event(type,{
            bubbles:true
    })))
  },mouseClick=async el=>{
        el.scrollIntoView({
            block:"center"
    });
    el.focus?.();
    const options={
            bubbles:true,cancelable:true,view:window,button:0,buttons:1
    };
    if(typeof PointerEvent!=="undefined")el.dispatchEvent(new PointerEvent("pointerdown",{
            ...options,pointerType:"mouse"
    }));
    el.dispatchEvent(new MouseEvent("mousedown",options));
    el.dispatchEvent(new MouseEvent("mouseup",{
            ...options,buttons:0
    }));
    el.click();
    await sleep(500);
    return el
  },commitField=async el=>{
        el.dispatchEvent(new Event("input",{
            bubbles:true
    }));
    el.dispatchEvent(new Event("change",{
            bubbles:true
    }));
    el.dispatchEvent(new Event("focusout",{
            bubbles:true
    }));
    el.blur?.();
    await sleep(400)
  },click=async target=>mouseClick(typeof target==="string"?await wait(target,target):target),normalizeFilter=value=>{
    const normalized=String(value||"UPDATED").trim().toUpperCase();
    return ["UPDATED","CREATED","ALL"].includes(normalized)?normalized:"UPDATED"
  },normalizePayloadType=value=>String(value||"data-object").trim().toLowerCase()==="segment"?"segment":"data-object",selectRunType=async mode=>{
    const expected=String(mode||"recurring").trim().toLowerCase();
    const radio=await wait(()=>[...document.querySelectorAll("oj-radioset#recurring-or-manual input[type='radio'], input[name='recurring-or-manual']")].find(input=>{
      const host=input.closest("oj-radioset,.oj-choice-item");
      return host&&visible(host)&&String(input.value||"").trim().toLowerCase()===expected
    })||null,`${expected} run type`);
    await click(labelFor(radio));
    if(!radio.checked){
      radio.click();
      radio.dispatchEvent(new Event("input",{bubbles:true}));
      radio.dispatchEvent(new Event("change",{bubbles:true}));
    }
    await wait(()=>radio.checked?radio:null,`${expected} run type selected`)
  },clickOjButton=async(id,label,nextReady)=>{
        const host=await wait(()=>[...document.querySelectorAll(`oj-button[id="${id}"]`)].find(visible),label+" host"),button=await wait(()=>{
            const x=host.querySelector("button.oj-button-button,button");
      return visible(x)?x:null
    },label+" button");
    await mouseClick(button);
    await sleep(600);
    if(nextReady&&!nextReady()){
            host.dispatchEvent(new CustomEvent("ojAction",{
                bubbles:true,cancelable:true,detail:{
                    originalEvent:null
        }
      }));
      await sleep(600)
    }
  },labelFor=input=>input.closest("label")||input.closest(".oj-choice-item,.oj-radio-wrapper,.oj-choice-row,.oj-button-toggle")?.querySelector("label")||document.querySelector(`label[for="${CSS.escape(input.id)}"]`)||input,selectFilterRecords=async filterValue=>{
        const filter=normalizeFilter(filterValue);
        const radio=await wait(()=>[...document.querySelectorAll('input[type="radio"]')].find(x=>!x.disabled&&String(x.value||"").trim().toUpperCase()===filter),`${filter} filter records radio`);
    await click(labelFor(radio));
    if(!radio.checked){
            radio.click();
      radio.dispatchEvent(new Event("input",{
                bubbles:true
      }));
      radio.dispatchEvent(new Event("change",{
                bubbles:true
      }));
      await sleep(400)
    }
        await wait(()=>radio.checked?radio:null,`${filter} filter records selected`)
  },chooseSearch=async(id,text)=>{
        const input=await wait(()=>document.getElementById(id),"dropdown "+id),host=input.closest("oj-select-single,oj-combobox-one,oj-combobox-many"),trigger=host?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field,.oj-text-field-container,[role=combobox]")||input;
    await click(trigger);
    const field=id.split("|input")[0],filter=await wait(()=>{
            const x=document.getElementById("oj-searchselect-filter-"+field+"|input");
      return visible(x)?x:(host?.querySelector("input:not([type=hidden]):not([disabled])")||input)
    },"dropdown filter");
    setValue(filter,text);
    await sleep(700);
    const option=await wait(()=>{
            const options=[...document.querySelectorAll('[role="option"],oj-option,li')].filter(visible);
      return options.find(x=>normalize(x.textContent)===normalize(text)||normalize(x.getAttribute("value"))===normalize(text))||options.find(x=>normalize(x.textContent).startsWith(normalize(text)))||null
    },"option "+text);
    await click(option.closest('[role="option"]')||option.closest("li,oj-option")||option);
    await sleep(400);
    return input
  },chooseCompression=async text=>{
        const input=await wait(()=>[...document.querySelectorAll('input[role="combobox"][aria-label="compressFormat"]')].find(visible)||null,"compression format dropdown");
    await chooseSearch(input.id,text);
    const host=input.closest("oj-select-single");
    await wait(()=>normalize(input.value)===normalize(text)||normalize(host?.value)===normalize(text)||normalize(host?.getAttribute("value"))===normalize(text)?input:null,"selected compression "+text)
  },chooseFrequency=async text=>{
        await wait(".schedule-job-container","schedule page");
    await sleep(700);
    const choice=await wait(()=>[...document.querySelectorAll("#oj-select-choice-frequency")].find(visible)||null,"frequency dropdown"),arrow=choice.querySelector(".oj-select-arrow")||choice,list=()=>[...document.querySelectorAll("#oj-listbox-results-frequency")].find(visible);
    await mouseClick(arrow);
    try{
            await wait(()=>choice.getAttribute("aria-expanded")==="true"&&list()?list():null,"open frequency options",2000)
    }
        catch(_){
            await mouseClick(choice);
      choice.dispatchEvent(new KeyboardEvent("keydown",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      await wait(()=>list()||null,"open frequency options",3000)
    }
        const option=await wait(()=>[...list().querySelectorAll('[role="option"]')].find(x=>visible(x)&&normalize(textOf(x))===normalize(text)),"frequency option "+text);
    await mouseClick(option);
    await wait(()=>{
            const selected=[...document.querySelectorAll("#frequency_selected")].find(visible);
      return selected&&normalize(textOf(selected))===normalize(text)?selected:null
    },"selected frequency "+text)
  },chooseButton=async(id,value)=>{
        const input=await wait(()=>[...document.querySelectorAll(`oj-buttonset-many#${CSS.escape(id)} input[value="${value}"]`)].find(x=>{
            const host=x.closest("oj-buttonset-many");
      return host&&visible(host)
    })||null,id+" option");
    await click(labelFor(input));
    await wait(()=>input.checked?input:null,`${id} value ${value} selected`)
  };
    const chooseSearchWithFallback=async(id,label,preferredValue)=>{
          const deadline=Date.now()+60000;
          let lastError;
          while(Date.now()<deadline){
                try{
                return await chooseSearch(id,preferredValue)
      }
                catch(error){
                lastError=error;
        await sleep(1000)
      }
    }
          throw new Error(`${label} "${preferredValue}" was not available after waiting for CDP to save it. ${lastError?.message||""}`.trim());
  };
    const typeValueLikeUser=async(el,value)=>{
          el.scrollIntoView({
            block:"center"
    });
          el.focus();
          const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
          setter?setter.call(el,""):el.value="";
          el.dispatchEvent(new Event("input",{
            bubbles:true
    }));
          for(const char of String(value)){
                el.dispatchEvent(new KeyboardEvent("keydown",{
                key:char,bubbles:true
      }));
                const next=(el.value||"")+char;
                setter?setter.call(el,next):el.value=next;
                el.dispatchEvent(new Event("input",{
                bubbles:true
      }));
                el.dispatchEvent(new KeyboardEvent("keyup",{
                key:char,bubbles:true
      }));
                await sleep(45);
    }
          el.dispatchEvent(new Event("change",{
            bubbles:true
    }));
          el.dispatchEvent(new Event("focusout",{
            bubbles:true
    }));
          el.blur?.();
          await sleep(400);
  };
    const setJetValueAndValidate=async(el,value)=>{
          el.scrollIntoView({
            block:"center"
    });
          el.focus();
          const component=el.closest("oj-input-text,oj-text-area,oj-select-single,oj-combobox-one,oj-combobox-many");
          const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
          setter?setter.call(el,value):el.value=value;
          el.dispatchEvent(new InputEvent("input",{
                bubbles:true,
                composed:true,
                inputType:"insertText",
                data:String(value)
    }));
          el.dispatchEvent(new Event("change",{
            bubbles:true,composed:true
    }));
          if(component){
                try{
                      if(typeof component.setProperty==="function"){
                            component.setProperty("rawValue",String(value));
                            component.setProperty("value",String(value));
        }
                else{
                            component.rawValue=String(value);
                            component.value=String(value);
        }
      }
            catch(_){
      }
                try{
                      component.dispatchEvent(new CustomEvent("rawValueChanged",{
                            bubbles:true,
                            composed:true,
                            detail:{
                        value:String(value)
          }
        }));
                      component.dispatchEvent(new CustomEvent("valueChanged",{
                            bubbles:true,
                            composed:true,
                            detail:{
                        value:String(value)
          }
        }));
      }
            catch(_){
      }
                try{
                      if(typeof component.validate==="function"){
                            await component.validate();
        }
      }
            catch(_){
      }
    }
          el.dispatchEvent(new Event("focusout",{
            bubbles:true,composed:true
    }));
          el.blur?.();
          await sleep(500);
  };
    const waitForContinueEnabled=async(id="job-details-continue-editjob")=>{
          return await wait(()=>{
                const host=document.getElementById(id);
                const button=host?.querySelector("button");
                const hostDisabled=
                  host?.classList.contains("oj-disabled")||
                  host?.getAttribute("aria-disabled")==="true";
                const buttonDisabled=!!button?.disabled;
                return host&&button&&!hostDisabled&&!buttonDisabled?button:null;
    },id+" enabled",3000);
  };
    try{
        if(!location.href.includes("root=createExportJob"))throw new Error("Open /data/?root=createExportJob before running this bookmark.");
    if(!hostKey)throw new Error("Could not extract the host key from the current URL.");
    await wait("div[class*='create-export-job-body']","Create Export page");
    const jobInput=await wait(()=>document.getElementById("job-name-input|input"),"job name");
    await setJetValueAndValidate(jobInput,jobName);
    const descriptionInput=await wait(()=>document.getElementById("job-desc-text-area|input"),"description");
    await setJetValueAndValidate(descriptionInput,C.description);
    await chooseSearchWithFallback("job-details-destinations|input","Destination",C.destination);
    const fileInput=await wait(()=>document.getElementById("job-details-fileName|input"),"file name");
    await setJetValueAndValidate(fileInput,fileName);
    await chooseCompression(C.compression);
    await click(await waitForContinueEnabled("job-details-continue-editjob"));
    await sleep(600);
    const payloadType=normalizePayloadType(C.payloadType);
    const isSegment=payloadType==="segment";
    const payloadRadio=await wait(()=>document.querySelector(`input[value="${payloadType}"]`),"Data payload type");
    await click(labelFor(payloadRadio));
    const payloadDropdown=isSegment?"segment-selection-attribute-dropdown|input":"data-object-selection-dropdown|input";
    await chooseSearch(payloadDropdown,C.payloadName);
    const activePayload=document.activeElement;
    if(activePayload&&activePayload!==document.body){
            activePayload.dispatchEvent(new Event("change",{
                bubbles:true
      }));
      activePayload.dispatchEvent(new Event("focusout",{
                bubbles:true
      }));
      activePayload.blur?.()
    }
        await sleep(400);
    const filterRecords=normalizeFilter(C.filterRecords);
    const filterRadioReady=()=>[...document.querySelectorAll('input[type="radio"]')]
      .some(input=>String(input.value||"").trim().toUpperCase()===filterRecords);
    const dataPayloadAdvanced=()=>!!find(".schedule-job-container")||!!find("#filter-records-continue")||filterRadioReady();
    await clickOjButton("job-details-continue","Data payload Continue",dataPayloadAdvanced);
    if(!isSegment){
      await wait(filterRadioReady,`${filterRecords} filter records`);
      await selectFilterRecords(filterRecords);
      await clickOjButton("filter-records-continue","Filter records Continue",()=>!!find(".schedule-job-container"));
    }
    else if(find("#filter-records-continue")){
      // Current Segment pages normally advance directly to Schedule. Keep this
      // fallback for tenants that retain the intermediate filter panel.
      await clickOjButton("filter-records-continue","Filter records Continue",()=>!!find(".schedule-job-container"));
    }
    await wait(".schedule-job-container","schedule page");
    // New Scheduler is applied by the shared page bridge before the job save.
    // Legacy Scheduler keeps the page-local recurring/manual controls.
    if(isSegment){
      if(window.__cdpSchedule?.schedulerUi==="new"){
        await window.__cdpApplyConfiguredSchedule();
      }
      else{
        const runMode=window.__cdpSchedule?.mode==="onDemand"?"onDemand":"recurring";
        await selectRunType(runMode);
        if(runMode==="recurring"){
          await chooseFrequency(C.frequency);
          await chooseButton(nextHourButtonset,nextHourValue);
        }
      }
    }
    else if(filterRecords!=="ALL"){
      if(window.__cdpSchedule?.schedulerUi==="new"){
        await window.__cdpApplyConfiguredSchedule();
      }
      else{
        await chooseFrequency(C.frequency);
        await chooseButton(nextHourButtonset,nextHourValue)
      }
    }
        await sleep(400);
    await clickOjButton("saveNclose-create-job","Save and Close")
  }
    catch(error){
        console.error("Export bookmark failed",error);
    alert("Export bookmark failed:\n"+error.message)
  }
})();
