(async()=>{
    const d=new Date(),dateTag=`${String(d.getDate()).padStart(2,"0")}${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${String(d.getFullYear()).slice(-2)}`,hostKey=location.hostname.split(".")[0].toUpperCase(),jobName=window.__cdpJobConfig?.name||`ImportJob_${dateTag}`,sourceObjectName=["CUSTOMER",hostKey,String(window.__cdpJobConfig?.purpose||"").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toUpperCase()].filter(Boolean).join("_"),C={
        description:"Independent import draft validation",source:window.__cdpJobConfig?.sourceName||`OOS-SRC-${dateTag}`,template:"ResponsysProfile",frequency:window.__cdpSchedule?.frequency||"Daily",notify:"test.user@oracle.com"
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
  },hover=async el=>{
        el.scrollIntoView({
            block:"center"
    });
    const options={
            bubbles:true,cancelable:true,view:window
    };
    el.dispatchEvent(new MouseEvent("mouseover",options));
    el.dispatchEvent(new MouseEvent("mouseenter",options));
    el.dispatchEvent(new MouseEvent("mousemove",options));
    await sleep(400)
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
  },click=async target=>mouseClick(typeof target==="string"?await wait(target,target):target),clickEnabled=async(selector,label)=>click(await wait(()=>{
        const candidates=[...document.querySelectorAll(selector)].filter(visible);
    return candidates.find(x=>!x.disabled&&x.getAttribute("aria-disabled")!=="true"&&!x.closest("oj-button")?.classList.contains("oj-disabled"))||null
  },label)),labelFor=input=>input.closest("label")||input.closest(".oj-choice-item,.oj-radio-wrapper,.oj-choice-row,.oj-button-toggle")?.querySelector("label")||document.querySelector(`label[for="${CSS.escape(input.id)}"]`)||input,chooseSearch=async(id,text)=>{
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
  },renameSourceObject=async()=>{
        if(document.getElementById(sourceObjectName))return;
    const ellipsis=await wait(()=>document.getElementById("PROFILE"),"PROFILE ellipsis"),hoverTarget=ellipsis.parentElement||ellipsis;
    await hover(hoverTarget);
    await hover(ellipsis);
    await mouseClick(ellipsis);
    const editAction=await wait(()=>[...document.querySelectorAll('[role="menuitem"],oj-option,button,a,li,span,div')].find(x=>visible(x)&&textOf(x)==="Edit")||null,"Edit source object action");
    await mouseClick(editAction.closest('[role="menuitem"],oj-option,button,a,li')||editAction);
    const nameInput=await wait(()=>[...document.querySelectorAll('input:not([type="hidden"]),textarea')].find(x=>visible(x)&&String(x.value||"").trim()==="PROFILE")||null,"PROFILE rename input");
    setValue(nameInput,sourceObjectName);
    await sleep(1000);
    const editor=nameInput.closest("oj-dialog,[role='dialog'],.oj-popup,.oj-popup-content")||document,saveAction=[...editor.querySelectorAll("button,oj-button button,[role='button']")].find(x=>visible(x)&&/^(save|apply|ok|done)$/i.test(textOf(x)));
    if(saveAction){
            await mouseClick(saveAction)
    }
        else{
            nameInput.dispatchEvent(new KeyboardEvent("keydown",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      nameInput.dispatchEvent(new KeyboardEvent("keyup",{
                key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true
      }));
      await commitField(nameInput)
    }
        await wait(()=>document.getElementById(sourceObjectName)||[...document.querySelectorAll(".ellipsis-id")].find(x=>x.id===sourceObjectName)||null,"renamed source object "+sourceObjectName)
  },chooseFrequency=async text=>{
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
    const waitLong=async(fn,label,timeout=120000)=>{
          const end=Date.now()+timeout;
          while(Date.now()<end){
                const value=typeof fn==="string"?find(fn):fn();
                if(value)return value;
                await sleep(250)
    }
          throw new Error("Timed out waiting for: "+label)
  };
    const createSourceObjectAndUploadSample=async(sourceConfig={},isAdditional=false)=>{
          const sourceObjectLabel=sourceConfig.sourceObjectName||sourceObjectName;
          const sourceActionText=isAdditional?"Add source object":"Create source object";
          const sampleFileName=sourceConfig.sampleFileName||"cdp_field_mapping.csv";
          const createButton=await wait(()=>{
                const candidates=[...document.querySelectorAll("oj-button,button,[role='button']")].filter(visible);
                return candidates.find(x=>normalize(textOf(x)).includes(normalize(sourceActionText)))||null
    },sourceActionText+" button");
          await click(createButton.querySelector?.("button")||createButton);
          const objectNameInput=await wait(()=>document.getElementById("object-name-input|input"),"source object name");
          await setJetValueAndValidate(objectNameInput,sourceObjectLabel);
          const dialog=objectNameInput.closest("oj-dialog,[role='dialog'],.oj-dialog,.oj-popup")||document;
          const confirmButton=await wait(()=>{
                const candidates=[...dialog.querySelectorAll("oj-button,button,[role='button']")].filter(visible);
                return candidates.find(x=>{
                      const label=normalize(textOf(x));
                      const button=x.matches("button")?x:x.querySelector?.("button");
                      const enabled=button?!button.disabled:true;
                      return enabled&&["create","save","continue","next","done"].some(t=>label===normalize(t)||label.includes(normalize(t)))
      })||null
    },"Create source object confirmation");
          await click(confirmButton.querySelector?.("button")||confirmButton);
          const picker=await waitLong(()=>{
                const candidates=[...document.querySelectorAll("oj-file-picker .oj-filepicker-dropzone,oj-file-picker .oj-filepicker-container,oj-file-picker")].filter(visible);
                return candidates[0]||null
    },"sample CSV file picker");
          const csvContent=sourceConfig.csvContent||window.__cdpImportConfig?.csvContent;
          if(!csvContent)throw new Error("Import Job sample CSV was not provided.");
          const file=new File([csvContent],sampleFileName,{
            type:"text/csv"
    });
          const filePicker=picker.closest("oj-file-picker")||document.querySelector("oj-file-picker");
          let accepted=false;
          try{
                const transfer=new DataTransfer();
                transfer.items.add(file);
                picker.dispatchEvent(new DragEvent("dragenter",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                picker.dispatchEvent(new DragEvent("dragover",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                picker.dispatchEvent(new DragEvent("drop",{
                      bubbles:true,
                      cancelable:true,
                      composed:true,
                      dataTransfer:transfer
      }));
                await sleep(800);
                accepted=!![...document.querySelectorAll(".file-list .filename")].find(x=>textOf(x)===sampleFileName);
    }
        catch(_e){
    }
          if(!accepted&&filePicker){
                try{
                      const transfer=new DataTransfer();
                      transfer.items.add(file);
                      filePicker.dispatchEvent(new CustomEvent("ojSelect",{
                            bubbles:true,
                            cancelable:true,
                            composed:true,
                            detail:{
                                  files:transfer.files,
                                  originalEvent:null
          }
        }));
                      await sleep(800);
                      accepted=!![...document.querySelectorAll(".file-list .filename")].find(x=>textOf(x)===sampleFileName);
      }
            catch(_e){
      }
    }
          if(!accepted){
                throw new Error("Oracle did not accept the generated CSV file automatically.");
    }
          const startMappingButton=await waitLong(()=>{
                const candidates=[...document.querySelectorAll("oj-button.btn-start-mapping,oj-button,button")].filter(visible);
                for(const candidate of candidates){
                      const label=normalize(textOf(candidate));
                      if(!label.includes(normalize("Start mapping")))continue;
                      const host=candidate.closest("oj-button")||candidate;
                      const button=host.matches("button")?host:host.querySelector("button");
                      const disabled=
                        host.classList?.contains("oj-disabled")||
                        host.getAttribute?.("aria-disabled")==="true"||
                        !!button?.disabled;
                      if(!disabled)return button||host
      }
                return null
          },"enabled Start Mapping button");
          await click(startMappingButton);
          // Give CDP a short, predictable window to render the source rows and
          // field editors before mapping starts. The Processing overlay can
          // linger even after rows are usable, so do not wait for it to vanish.
          await sleep(4000);
          await waitLong(()=>{
                const grid=document.querySelector("oj-list-view#fieldMappingList ul[role='grid'][aria-label='FieldMappingData']");
                const rows=document.querySelectorAll("oj-list-view#fieldMappingList li[role='row']");
                return grid&&rows.length>0;
          },"field mapping table to load",120000);
          await waitLong("oj-list-view#fieldMappingList ul[role='grid'][aria-label='FieldMappingData']","field mapping table",120000);
          await waitLong("oj-list-view#fieldMappingList li[role='row']","field mapping rows",120000);
          if(typeof window.runCdpFieldMapping!=="function"){
                throw new Error("The shared Import Job field mapper was not loaded.");
          }
          const mappingResult=await window.runCdpFieldMapping(sourceConfig.targetTables||window.__cdpImportConfig?.targetTables,sourceConfig.fieldToTable||window.__cdpImportConfig?.fieldToTable);
          console.info("Import field mapping result",mappingResult);
  };
    try{
        if(!location.href.includes("root=createConnectJob"))throw new Error("Open /data/?root=createConnectJob before running.");
    if(!hostKey)throw new Error("Could not extract the host key from the current URL.");
    await wait("div[class*='create-connect-job-body']","Create Ingest Job");
    const jobInput=await wait(()=>document.getElementById("job-name-input|input"),"job name");
    await setJetValueAndValidate(jobInput,jobName);
    const descriptionInput=await wait(()=>document.getElementById("job-desc-text-area|input"),"description");
    await setJetValueAndValidate(descriptionInput,C.description);
    await chooseSearchWithFallback("job-details-sources|input","Source",C.source);
    await click(await waitForContinueEnabled("job-details-continue-editjob"));
    const configuredSources=Array.isArray(window.__cdpImportConfig?.sources)&&window.__cdpImportConfig.sources.length
      ? window.__cdpImportConfig.sources
      : [{targetTables:window.__cdpImportConfig?.targetTables,fieldToTable:window.__cdpImportConfig?.fieldToTable,csvContent:window.__cdpImportConfig?.csvContent,sourceObjectName}];
    for(let index=0;index<configuredSources.length;index+=1){
          const configuredSource={...configuredSources[index]};
          configuredSource.sourceObjectName=configuredSource.sourceObjectName||[String(configuredSource.sourceCode||"CUSTOMER").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toUpperCase(),hostKey,String(window.__cdpJobConfig?.purpose||"").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").toUpperCase()].filter(Boolean).join("_");
          configuredSource.sampleFileName=configuredSource.sampleFileName||`cdp_${configuredSource.sourceCode||"field"}_mapping.csv`;
          await createSourceObjectAndUploadSample(configuredSource,index>0);
    }
    await waitLong("oj-list-view#fieldMappingList ul[role='grid'][aria-label='FieldMappingData']","field mapping table",120000);
    await waitLong("oj-list-view#fieldMappingList li[role='row']","field mapping rows",120000);
    await clickEnabled("#field-mapping-container oj-button button","Field Mapping Continue");
    await wait(".schedule-job-container","schedule page");
    const scheduleMode=window.__cdpSchedule?.mode;
    // New Scheduler is shared with Export through jobSchedulerBridge.js.
    // Legacy Scheduler keeps the existing page-local controls unchanged.
    if(window.__cdpSchedule?.schedulerUi==="new"){
            await window.__cdpApplyConfiguredSchedule();
    }
        else{
            const recurring=await wait(()=>[...document.querySelectorAll("oj-radioset#recurring-or-manual input[value='Recurring']")].find(x=>{
                const host=x.closest("oj-radioset");
        return host&&visible(host)
      })||null,"Recurring schedule"),manual=scheduleMode==="onDemand"?await wait(()=>[...document.querySelectorAll("oj-radioset#recurring-or-manual input[value='Manual'],oj-radioset#recurring-or-manual input[value='OnDemand']")].find(x=>{
                const host=x.closest("oj-radioset");
        return host&&visible(host)
      })||null,"On-demand schedule"):null;
      await click(labelFor(scheduleMode==="onDemand"?manual:recurring));
      if(scheduleMode!=="onDemand"){
                await chooseFrequency(C.frequency);
        await chooseButton(nextHourButtonset,nextHourValue);
        if(C.frequency==="Weekly")await chooseButton("recurring-weekly","2");
      }
    }
        const notifyInput=await wait(()=>document.getElementById("notify-input|input"),"notification email");
    setValue(notifyInput,C.notify);
    await commitField(notifyInput);
    await clickEnabled("oj-button#saveNclose-create-job button","Save and Close")
  }
    catch(error){
        console.error("Import bookmark failed",error);
    alert("Import bookmark failed:\n"+error.message)
  }
})();
